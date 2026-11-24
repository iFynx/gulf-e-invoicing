<?php

declare(strict_types=1);

namespace IFynx\GulfEInvoicing\Zatca;

/** Result of signing an invoice. */
final class Signed
{
    /** @param array{rows:list<array<string,mixed>>,net:float,vat:float,gross:float} $totals */
    public function __construct(
        public readonly string $xml,
        public readonly string $invoiceHash,
        public readonly string $signature,
        public readonly string $propsHash,
        public readonly string $qr,
        public readonly array $totals,
        public readonly string $signingTime,
    ) {
    }
}
