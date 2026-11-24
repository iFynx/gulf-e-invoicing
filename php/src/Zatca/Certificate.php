<?php

declare(strict_types=1);

namespace IFynx\GulfEInvoicing\Zatca;

use IFynx\GulfEInvoicing\Der;

/** Values the engine needs from an X.509 (CSID) certificate. */
final class Certificate
{
    private const NAMES = [
        '2.5.4.3' => 'CN', '2.5.4.6' => 'C', '2.5.4.7' => 'L', '2.5.4.8' => 'ST', '2.5.4.9' => 'street',
        '2.5.4.10' => 'O', '2.5.4.11' => 'OU', '2.5.4.5' => 'serialNumber', '2.5.4.4' => 'SN',
        '2.5.4.42' => 'GN', '2.5.4.12' => 'title', '2.5.4.97' => 'organizationIdentifier',
        '0.9.2342.19200300.100.1.25' => 'DC', '0.9.2342.19200300.100.1.1' => 'UID',
        '1.2.840.113549.1.9.1' => 'emailAddress',
    ];

    public function __construct(
        public readonly string $b64,
        public readonly string $hash,
        public readonly string $issuer,
        public readonly string $serial,
        public readonly string $publicKey,
        public readonly string $signature,
    ) {
    }

    /** Read a CSID certificate (base64 DER body; a PEM is accepted too). */
    public static function fromBase64(string $cert): self
    {
        $b64 = (string) preg_replace('/-----[^-]+-----|\s+/', '', $cert);
        $der = base64_decode($b64, true);
        if ($der === false || $der === '') {
            throw new \InvalidArgumentException('Certificate is not valid base64');
        }
        [$top] = Der::items($der, 0, strlen($der));
        [$tbs, , $sigBits] = Der::items($der, $top['start'], $top['end']);
        $f = Der::items($der, $tbs['start'], $tbs['end']);
        $o = $f[0]['tag'] === 0xA0 ? 1 : 0;
        $serial = Der::toDecimal(ltrim(Der::slice($der, $f[$o]), "\0"));
        $rdns = [];
        foreach (Der::items($der, $f[$o + 2]['start'], $f[$o + 2]['end']) as $set) {
            $atvs = [];
            foreach (Der::items($der, $set['start'], $set['end']) as $atv) {
                [$oid, $val] = Der::items($der, $atv['start'], $atv['end']);
                $id = Der::oid(Der::slice($der, $oid));
                $atvs[] = (self::NAMES[$id] ?? $id) . '=' . self::escape(Der::slice($der, $val));
            }
            $rdns[] = implode('+', $atvs);
        }
        return new self(
            $b64,
            base64_encode(hash('sha256', $b64)),
            implode(', ', array_reverse($rdns)),
            $serial,
            base64_encode(Der::slice($der, $f[$o + 5], true)),
            base64_encode(substr(Der::slice($der, $sigBits), 1)),
        );
    }

    private static function escape(string $v): string
    {
        $v = (string) preg_replace('/([\\\\,+"<>;=])/', '\\\\$1', $v);
        $v = (string) preg_replace('/^([ #])/', '\\\\$1', $v);
        return (string) preg_replace('/ $/', '\\\\ ', $v);
    }
}
