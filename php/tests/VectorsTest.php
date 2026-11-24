<?php

declare(strict_types=1);

namespace IFynx\GulfEInvoicing\Tests;

use IFynx\GulfEInvoicing\UaePintAe\Invoice as Uae;
use IFynx\GulfEInvoicing\Zatca\Certificate;
use IFynx\GulfEInvoicing\Zatca\Invoice as Zatca;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/** The PHP port must reproduce the JavaScript engines byte-for-byte. */
final class VectorsTest extends TestCase
{
    private static function root(): string
    {
        return dirname(__DIR__, 2);
    }

    /** @return array<string,mixed> */
    private static function vectors(string $name): array
    {
        return json_decode((string) file_get_contents(self::root() . "/test-vectors/{$name}.json"), true, 512, JSON_THROW_ON_ERROR);
    }

    public static function zatcaCases(): iterable
    {
        foreach (self::vectors('zatca')['cases'] as $c) {
            yield $c['invoice']['number'] => [$c];
        }
    }

    public static function uaeCases(): iterable
    {
        foreach (self::vectors('uae-pint-ae')['cases'] as $c) {
            yield $c['invoice']['number'] => [$c];
        }
    }

    public function testCertificateMatchesJs(): void
    {
        $z = self::vectors('zatca');
        $c = Certificate::fromBase64((string) file_get_contents(self::root() . '/' . $z['cert_file']));
        self::assertSame(
            [$z['cert']['b64'], $z['cert']['hash'], $z['cert']['issuer'], $z['cert']['serial'], $z['cert']['publicKey'], $z['cert']['signature']],
            [$c->b64, $c->hash, $c->issuer, $c->serial, $c->publicKey, $c->signature],
        );
    }

    /** @param array<string,mixed> $case */
    #[DataProvider('zatcaCases')]
    public function testZatca(array $case): void
    {
        $z = self::vectors('zatca');
        $key = Zatca::loadPrivateKey((string) file_get_contents(self::root() . '/' . $z['key_pem_file']));
        $cert = Certificate::fromBase64((string) file_get_contents(self::root() . '/' . $z['cert_file']));
        $inv = $case['invoice'];
        $t = Zatca::totals($inv['lines']);
        self::assertEquals([$case['totals']['net'], $case['totals']['vat'], $case['totals']['gross']], [$t['net'], $t['vat'], $t['gross']]);
        self::assertSame($case['validate'], Zatca::validate($inv));
        self::assertSame($case['pure'], Zatca::xml($inv, $t, pure: true));

        $r = Zatca::sign($inv, $key, $cert, new \DateTimeImmutable($z['now']));
        self::assertSame($case['invoiceHash'], $r->invoiceHash);
        self::assertSame($case['propsHash'], $r->propsHash);
        self::assertSame($case['signingTime'], $r->signingTime);
        // OpenSSL signs with a random nonce: the value differs, so verify it and compare everything else.
        $pub = openssl_pkey_get_public("-----BEGIN PUBLIC KEY-----\n" . chunk_split($cert->publicKey, 64, "\n") . "-----END PUBLIC KEY-----\n");
        self::assertSame(1, openssl_verify((string) base64_decode($r->invoiceHash), (string) base64_decode($r->signature), $pub, OPENSSL_ALGO_SHA256));
        self::assertSame(1, openssl_verify((string) base64_decode($case['invoiceHash']), (string) base64_decode($case['signature']), $pub, OPENSSL_ALGO_SHA256), 'JS signature verifies in PHP too');
        self::assertSame(str_replace($r->signature, $case['signature'], $r->xml), self::withoutQr($case['xml'], $r->qr, $case['qr']));
        $tags = Zatca::readQr($r->qr);
        self::assertSame(range(1, 9), array_column($tags, 'tag'));
        $js = Zatca::readQr($case['qr']);
        foreach ([0, 1, 2, 3, 4, 5, 7, 8] as $i) {
            self::assertSame($js[$i]['value'], $tags[$i]['value'], 'QR tag ' . ($i + 1));
        }
    }

    private static function withoutQr(string $xml, string $mine, string $theirs): string
    {
        return str_replace($theirs, $mine === $theirs ? $theirs : $mine, $xml);
    }

    public function testInvalid(): void
    {
        foreach (self::vectors('zatca')['invalid'] as $c) {
            self::assertSame($c['expect'], Zatca::validate($c));
        }
    }

    public function testRejectsWrongCurve(): void
    {
        $k = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'prime256v1']);
        openssl_pkey_export($k, $pem);
        $this->expectException(\InvalidArgumentException::class);
        Zatca::loadPrivateKey($pem);
    }

    /** @param array<string,mixed> $case */
    #[DataProvider('uaeCases')]
    public function testUae(array $case): void
    {
        $inv = $case['invoice'];
        $t = Uae::totals($inv['lines']);
        self::assertEquals([$case['totals']['net'], $case['totals']['vat'], $case['totals']['gross']], [$t['net'], $t['vat'], $t['gross']]);
        self::assertSame($case['xml'], Uae::xml($inv, $t));
        self::assertSame($case['check'], Uae::check($inv, $t));
    }

    public function testTrn(): void
    {
        foreach (self::vectors('uae-pint-ae')['trn'] as $c) {
            self::assertSame($c['ok'], Uae::trnOk($c['v']));
            self::assertSame($c['tin'], Uae::tin($c['v']));
        }
    }
}
