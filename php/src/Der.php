<?php

declare(strict_types=1);

namespace IFynx\GulfEInvoicing;

/**
 * Minimal DER reader for the X.509 fields ZATCA needs.
 *
 * @internal
 */
final class Der
{
    /** @return list<array{tag:int,start:int,end:int,hdr:int}> */
    public static function items(string $buf, int $start, int $end): array
    {
        $out = [];
        $i = $start;
        while ($i < $end) {
            $tag = ord($buf[$i]);
            $len = ord($buf[$i + 1]);
            $hdr = 2;
            if ($len & 0x80) {
                $n = $len & 0x7f;
                $len = 0;
                for ($k = 0; $k < $n; $k++) {
                    $len = ($len << 8) | ord($buf[$i + 2 + $k]);
                }
                $hdr = 2 + $n;
            }
            $out[] = ['tag' => $tag, 'start' => $i + $hdr, 'end' => $i + $hdr + $len, 'hdr' => $hdr];
            $i += $hdr + $len;
        }
        return $out;
    }

    public static function slice(string $buf, array $item, bool $withHeader = false): string
    {
        $from = $withHeader ? $item['start'] - $item['hdr'] : $item['start'];
        return substr($buf, $from, $item['end'] - $from);
    }

    /** Unsigned big-endian bytes to a decimal string (no GMP/BCMath needed). */
    public static function toDecimal(string $bytes): string
    {
        $digits = array_values(unpack('C*', $bytes) ?: []);
        $out = '';
        while ($digits !== []) {
            $rem = 0;
            $next = [];
            foreach ($digits as $d) {
                $cur = ($rem << 8) | $d;
                $q = intdiv($cur, 10);
                $rem = $cur % 10;
                if ($next !== [] || $q !== 0) {
                    $next[] = $q;
                }
            }
            $out = $rem . $out;
            $digits = $next;
        }
        return $out === '' ? '0' : $out;
    }

    public static function oid(string $bytes): string
    {
        $first = ord($bytes[0]);
        $parts = [intdiv($first, 40), $first % 40];
        $v = 0;
        for ($i = 1, $n = strlen($bytes); $i < $n; $i++) {
            $b = ord($bytes[$i]);
            $v = ($v << 7) | ($b & 0x7f);
            if (!($b & 0x80)) {
                $parts[] = $v;
                $v = 0;
            }
        }
        return implode('.', $parts);
    }
}
