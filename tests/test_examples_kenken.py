from pathlib import Path

from helpers import solve_all_in_path



def test_ex_kenken():
    solve_all_in_path(Path("../Examples/Kenken"), False)
