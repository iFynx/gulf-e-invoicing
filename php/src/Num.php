<?php

declare(strict_types=1);

namespace IFynx\GulfEInvoicing;

/**
 * Number helpers that match the JavaScript engines exactly (IEEE-754 doubles).
 *
 * @internal
 */
final class Num
{
    /** Round to 2 decimals like Math.round((n + Number.EPSILON) * 100) / 100. */
    public static function r2(float|int $n): float
    {
        return floor(($n + PHP_FLOAT_EPSILON) * 100 + 0.5) / 100;
    }

    /** Two decimals, like r2(n).toFixed(2). */
    public static function money(float|int $n): string
    {
        return sprintf('%.2f', self::r2($n));
    }

    /** A number as JavaScript prints it ("2", not "2.0"). */
    public static function js(float|int $n): string
    {
        if (is_int($n)) {
            return (string) $n;
        }
        if (is_finite($n) && $n == floor($n) && abs($n) < 1e15) {
            return (string) (int) $n;
        }
        // Shortest round-trip form, independent of the "precision" ini setting.
        return (string) json_encode($n, JSON_PRESERVE_ZERO_FRACTION);
    }
}
