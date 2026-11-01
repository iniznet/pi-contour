package sample

type Number interface{ ~int | ~float64 }

func Map[T any, U any](items []T, pick func(T) U) []U {
	out := make([]U, 0, len(items))
	for _, item := range items {
		out = append(out, pick(item))
	}
	return out
}

func (s *Stack[T]) Push(v T) {
	s.items = append(s.items, v)
}

func main() {
	double := func(n int) int { return n * 2 }
	if v := Map([]int{1}, double); len(v) > 0 && v[0] == 2 {
		println("ok")
	}
}
