import pytest

from gridsolver.grid_classes.sudoku import Sudoku
from gridsolver.solver.candidate_topology import CandidateTopology
from gridsolver.solver.solve_aic import alternating_inference_chain
from gridsolver.solver.solve_als import ALSAnalysis, als_xy_wing, als_xz
from gridsolver.solver.solve_empty_rectangle import empty_rectangle
from gridsolver.solver.solve_locked_candidate import locked_candidate
from gridsolver.solver.solve_skyscraper import skyscraper


@pytest.mark.parametrize(
    "consumer",
    (
        locked_candidate,
        skyscraper,
        empty_rectangle,
        alternating_inference_chain,
    ),
)
def test_candidate_topology_rejects_a_different_grid(consumer):
    source = Sudoku(2, 2, 2, 2)
    other = Sudoku(2, 2, 2, 2)
    topology = CandidateTopology.build(source)

    with pytest.raises(ValueError, match="another grid"):
        consumer(other, topology)


def test_als_analysis_rejects_a_different_grid():
    source = Sudoku(2, 2, 2, 2)
    other = Sudoku(2, 2, 2, 2)
    topology = CandidateTopology.build(source)
    analysis = ALSAnalysis.build(source, topology)

    for consumer in (als_xz, als_xy_wing):
        with pytest.raises(ValueError, match="another grid"):
            consumer(other, analysis)


def test_als_build_rejects_a_topology_from_a_different_grid():
    source = Sudoku(2, 2, 2, 2)
    other = Sudoku(2, 2, 2, 2)
    topology = CandidateTopology.build(source)

    with pytest.raises(ValueError, match="another grid"):
        ALSAnalysis.build(other, topology)
