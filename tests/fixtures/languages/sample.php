<?php

namespace App;

use App\Engine\Runner;
use App\Support\Clock;

class Shape
{
    public function area(): int
    {
        return $this->w * $this->h;
    }
}

function classify(int $n): string
{
    if ($n < 0) {
        return "negative";
    } elseif ($n === 0) {
        return "zero";
    }
    foreach ([1, 2] as $value) {
        if ($value % 2 === 0 && $n > 1) {
            return "even";
        }
    }
    $label = $n === 1 ? "one" : "many";
    return $label;
}

function load(string $path): string
{
    try {
        $handle = require __DIR__ . '/boot.php';
        return (string) $handle;
    } catch (RuntimeException $error) {
        throw $error;
    }
}

$double = fn ($x) => $x * 2;
