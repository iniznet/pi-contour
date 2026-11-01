import os
from .engine import Engine


class Shape:
    def __init__(self, w, h):
        self.w = w
        self.h = h

    def area(self):
        return self.w * self.h


def classify(n):
    if n < 0:
        return "negative"
    elif n == 0:
        return "zero"
    for i in range(3):
        if i % 2 == 0 and n > 1:
            return "even"
    label = "one" if n == 1 else "many"
    return label


def load(path):
    try:
        with open(path) as handle:
            return handle.read()
    except OSError as error:
        raise error
