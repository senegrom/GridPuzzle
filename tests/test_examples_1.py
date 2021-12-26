from argparse import Namespace

from pytest import raises

import examples
from gridsolver.abstract_grids import solver


def _example_test(x: str):
    args = Namespace(example=x)
    g = examples.get_example(args)
    sol = solver.solve(g)
    assert len(sol) == 1


def test_ex_a():
    _example_test("a")


def test_ex_b():
    _example_test("b")


def test_ex_c():
    _example_test("c")


def test_ex_d():
    _example_test("d")


def test_ex_f():
    _example_test("f")


def test_ex_m():
    _example_test("m")


def test_ex_s():
    _example_test("s")


def test_ex_t():
    _example_test("t")


def test_ex_x():
    with raises(ValueError):
        _example_test("x")
