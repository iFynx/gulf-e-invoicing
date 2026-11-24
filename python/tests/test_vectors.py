"""The Python port must reproduce the JavaScript engines byte-for-byte."""
import base64
import json
from datetime import datetime
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec

from gulf_einvoicing import uae_pint_ae, zatca

ROOT = Path(__file__).resolve().parents[2]
Z = json.loads((ROOT / "test-vectors/zatca.json").read_text())
U = json.loads((ROOT / "test-vectors/uae-pint-ae.json").read_text())
KEY = zatca.load_private_key((ROOT / Z["key_pem_file"]).read_text())
CERT = zatca.cert_info((ROOT / Z["cert_file"]).read_text())
NOW = datetime.fromisoformat(Z["now"].replace("Z", "+00:00"))


def test_cert_info_matches_js():
    js = Z["cert"]
    assert (CERT.b64, CERT.hash, CERT.issuer, CERT.serial, CERT.public_key, CERT.signature) == (
        js["b64"], js["hash"], js["issuer"], js["serial"], js["publicKey"], js["signature"])


@pytest.mark.parametrize("case", Z["cases"], ids=lambda c: c["invoice"]["number"])
def test_zatca_case(case):
    inv = case["invoice"]
    t = zatca.totals(inv["lines"])
    assert (t["net"], t["vat"], t["gross"]) == (case["totals"]["net"], case["totals"]["vat"], case["totals"]["gross"])
    assert zatca.validate(inv) == case["validate"]
    assert zatca.invoice_xml(inv, t, pure=True) == case["pure"]
    r = zatca.sign_invoice(inv, KEY, CERT, NOW)
    assert r.invoice_hash == case["invoiceHash"]
    assert r.props_hash == case["propsHash"]
    assert r.signing_time == case["signingTime"]
    assert r.signature == case["signature"], "RFC 6979 + low-S must match the JS signature"
    assert r.qr == case["qr"]
    assert r.xml == case["xml"]
    KEY.public_key().verify(base64.b64decode(r.signature), base64.b64decode(r.invoice_hash), ec.ECDSA(hashes.SHA256()))
    tags = zatca.read_qr(r.qr)
    assert [x["tag"] for x in tags] == list(range(1, 10))


def test_zatca_invalid():
    for c in Z["invalid"]:
        assert zatca.validate(c) == c["expect"]


def test_qr_tag_too_long():
    inv = dict(Z["cases"][0]["invoice"])
    inv["seller"] = {**inv["seller"], "name": "x" * 256}
    with pytest.raises(ValueError):
        zatca.sign_invoice(inv, KEY, CERT, NOW)


def test_rejects_wrong_curve():
    from cryptography.hazmat.primitives import serialization
    pem = ec.generate_private_key(ec.SECP256R1()).private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    with pytest.raises(ValueError):
        zatca.load_private_key(pem)


@pytest.mark.parametrize("case", U["cases"], ids=lambda c: c["invoice"]["number"])
def test_uae_case(case):
    inv = case["invoice"]
    t = uae_pint_ae.totals(inv["lines"])
    assert (t["net"], t["vat"], t["gross"]) == (case["totals"]["net"], case["totals"]["vat"], case["totals"]["gross"])
    assert uae_pint_ae.invoice_xml(inv, t) == case["xml"]
    assert uae_pint_ae.check(inv, t) == case["check"]


def test_uae_trn():
    for c in U["trn"]:
        assert uae_pint_ae.trn_ok(c["v"]) is c["ok"]
        assert uae_pint_ae.tin(c["v"]) == c["tin"]
