class ValidationFailed(Exception):
    """The request was well-formed but unacceptable. `fields` maps field name to message."""

    def __init__(self, fields: dict[str, str]):
        super().__init__("; ".join(f"{k}: {v}" for k, v in fields.items()))
        self.fields = fields
