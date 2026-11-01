<?php

namespace App;

#[Attribute]
class Marker
{
}

enum Suit: string
{
    case Hearts = 'H';
    case Spades = 'S';
}

final class Service
{
    public function grade(int $n): string
    {
        return match (true) {
            $n > 90 => 'A',
            $n > 80 => 'B',
            default => 'C',
        };
    }

    public function walk(array $items): void
    {
        foreach ($items as $item) {
            switch ($item) {
                case 'a':
                    $this->grade(1);
                    break;
                default:
                    break;
            }
        }
    }
}
