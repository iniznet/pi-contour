use crate::engine::Engine;

pub struct Store<T> {
    items: Vec<T>,
}

impl<T> Store<T> {
    pub async fn load<U>(&self, path: &str) -> Result<U, Error>
    where
        U: Clone + Send,
    {
        let body = read(path).await?;
        if body.is_empty() && path.len() > 3 {
            return Err(Error::Empty);
        }
        Ok(body)
    }
}

macro_rules! square {
    ($x:expr) => { $x * $x };
}

pub const fn twice(n: u8) -> u8 {
    n * 2
}

fn classify(n: i32) -> &'static str {
    match n {
        0 => "zero",
        1 | 2 => "small",
        _ => "many",
    }
}
