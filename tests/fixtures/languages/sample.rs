use crate::engine::Engine;
use std::collections::HashMap;

pub struct Shape {
    w: i32,
    h: i32,
}

impl Shape {
    pub fn area(&self) -> i32 {
        self.w * self.h
    }
}

pub fn classify(n: i32) -> &'static str {
    if n < 0 {
        "negative"
    } else if n == 0 {
        "zero"
    } else {
        match n {
            1 => "one",
            2 => "two",
            _ => "many",
        }
    }
}

fn run(items: &[i32]) -> i32 {
    let mut total = 0;
    for item in items {
        while *item > 0 && total < 10 {
            total += *item;
            break;
        }
    }
    let twice = |x: i32| { x * 2 };
    total + twice(total)
}
