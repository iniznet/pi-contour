package sample

import (
	"fmt"
	"os"
)

func Classify(n int) string {
	if n < 0 {
		return "negative"
	} else if n == 0 {
		return "zero"
	}
	for i := 0; i < 3; i++ {
		if i%2 == 0 && n > 1 {
			return "even"
		}
	}
	switch n {
	case 1:
		return "one"
	case 2:
		return "two"
	default:
		return "many"
	}
}

func (s *Shape) Area() int {
	return s.w * s.h
}

func main() {
	double := func(x int) int {
		return x * 2
	}
	fmt.Println(double(2), os.Getenv("HOME"))
}
