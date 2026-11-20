"""Personal Kina reader, using Nyerk's public packet hooks. Never sends game traffic."""
from aion2_tracker import protocol as P


def balance_packet(packet):
    if P.opcode(packet) != (0x1B, 0x56):
        return None
    _, size = P.read_varint(packet, 0)
    body = packet[size + 2:]
    if not size or len(body) < 23 or body[0] != 1:
        return None
    currency = {930100031: "unbound", 930100001: "bound"}.get(int.from_bytes(body[11:15], "little"))
    if currency is None:
        return None
    balance = int.from_bytes(body[15:23], "little")
    return {"currency": currency, "balance": balance} if balance <= 2**53 - 1 else None


def setup(api):
    @api.on_zone
    def zone(_world):
        api.emit("boundary")

    @api.on_packet
    def packet(_ts, raw):
        # parse_character is the local character record, unlike parse_player (everyone nearby).
        who = P.parse_character(raw)
        if who is None:
            credit = P.parse_kill_credit(raw)
            if credit and api.self_entity is not None and credit.killer == api.self_entity:
                who = credit
        if who is not None:
            api.emit("identity", {"name": who.name, "server": who.server})
        balance = balance_packet(raw)
        if balance is not None:
            api.emit("balance", balance)

    @api.every(5)
    def refresh():
        api.emit("refresh")
