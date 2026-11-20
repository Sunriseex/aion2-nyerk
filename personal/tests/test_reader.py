import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("personal_reader", Path(__file__).parents[1] / "addon/reader.py")
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


def record(item, balance):
    body = b"\x01" + bytes(10) + item.to_bytes(4, "little") + balance.to_bytes(8, "little")
    return bytes([len(body) + 6]) + b"\x1b\x56" + body


def test_both_currencies_and_combined_balance():
    assert reader.balance_packet(record(930100001, 12)) == {"currency": "bound", "balance": 12}
    assert reader.balance_packet(record(930100031, 0)) == {"currency": "unbound", "balance": 0}
    assert reader.balance_packet(record(930100030, 1000)) is None
    assert reader.balance_packet(record(930100001, 2**53)) is None


def test_truncated_records():
    packet = record(930100001, 100)
    for size in range(len(packet)):
        assert reader.balance_packet(packet[:size]) is None


def test_identity_uses_only_local_character_or_confirmed_self_kill(monkeypatch):
    from types import SimpleNamespace
    class Api:
        self_entity = 10
        def __init__(self):
            self.events = []
        def on_zone(self, fn): self.zone = fn
        def on_packet(self, fn): self.packet = fn
        def every(self, _seconds): return lambda fn: fn
        def emit(self, *args): self.events.append(args)
    api = Api()
    reader.setup(api)
    monkeypatch.setattr(reader.P, "parse_character", lambda _: None)
    monkeypatch.setattr(reader.P, "parse_kill_credit", lambda _: SimpleNamespace(killer=20, name="Other", server=1104))
    api.packet(0, b"")
    assert api.events == []
    monkeypatch.setattr(reader.P, "parse_kill_credit", lambda _: SimpleNamespace(killer=10, name="Mine", server=1104))
    api.packet(0, b"")
    assert api.events == [("identity", {"name": "Mine", "server": 1104})]
    api.zone(None)
    assert api.events[-1] == ("boundary",)
