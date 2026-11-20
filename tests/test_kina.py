import pytest

from aion2_tracker.protocol import parse_kina


def item_packet(item: int, balance: int) -> bytes:
    body = b"\x01" + bytes(10) + item.to_bytes(4, "little") + balance.to_bytes(8, "little")
    return bytes([len(body) + 6]) + b"\x1b\x56" + body


@pytest.mark.parametrize("item,kind", [(930100031, "unbound"), (930100001, "bound")])
@pytest.mark.parametrize("balance", [0, 1234567, 2**32 + 100])
def test_currency_balance(item, kind, balance):
    assert parse_kina(item_packet(item, balance)) == (kind, balance)


def test_ignores_other_items_and_combined_balance():
    for item in (930100030, 930100023, 1):
        assert parse_kina(item_packet(item, 1000)) is None


def test_rejects_truncated_records_and_other_opcodes():
    packet = item_packet(930100001, 100)
    for length in range(len(packet)):
        assert parse_kina(packet[:length]) is None
    assert parse_kina(packet[:1] + b"\x1c\x56" + packet[3:]) is None
