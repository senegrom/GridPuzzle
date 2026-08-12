import pytest
from pathlib import Path

from helpers import solve_all_in_path


pytestmark = pytest.mark.slow


def test_ex_killer():
    solve_all_in_path(Path("../Examples/KillerSudoku"), False)
