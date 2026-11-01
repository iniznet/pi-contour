import os


class Cache:
    slot: dict = {}

    async def get(self, key, /, default=None):
        if (hit := self.slot.get(key)) is not None:
            return hit
        return default


def classify(value):
    match value:
        case "a":
            return 1
        case {"k": item} if item > 0:
            return item
        case _:
            return 0
