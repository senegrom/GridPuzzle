import json
from pathlib import Path
import pytest
from gridsolver.web_api import build_grid
from scripts.build_web import build_destination, validate_output

FIXTURES = json.loads(
    (Path(__file__).parents[1] / "web/tests/fixtures/payloads.json").read_text()
)


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda f: f["name"])
def test_shared_payload_contract(fixture):
    if fixture["solver"]:
        build_grid(fixture["payload"])
    else:
        with pytest.raises(ValueError):
            build_grid(fixture["payload"])


@pytest.mark.parametrize(
    "name",
    ["web", "gridsolver", ".git", "tests", "scripts", ".", "..", "web/generated"],
)
def test_builder_refuses_source_paths_without_deleting(name, tmp_path):
    root = tmp_path / "repo"
    root.mkdir()
    (root / "web").mkdir()
    sentinel = root / "web/source.js"
    sentinel.write_text("keep")
    with pytest.raises(ValueError), build_destination(root, name):
        pytest.fail("unsafe output accepted")
    assert sentinel.read_text() == "keep"


def test_builder_refuses_unowned_existing_directory(tmp_path):
    root = tmp_path / "repo"
    root.mkdir()
    out = root / "_site"
    out.mkdir()
    (out / "sentinel").write_text("keep")
    with pytest.raises(ValueError), build_destination(root, "_site"):
        pass
    assert (out / "sentinel").read_text() == "keep"


def test_failed_build_preserves_previous_output_and_success_replaces_it(tmp_path):
    root = tmp_path / "repo"
    root.mkdir()
    with build_destination(root, "_site") as out:
        (out / "index.html").write_text("old")
    with pytest.raises(RuntimeError), build_destination(root, "_site") as out:
        (out / "index.html").write_text("partial")
        raise RuntimeError("build failed")
    assert (root / "_site/index.html").read_text() == "old"
    with build_destination(root, "_site") as out:
        (out / "index.html").write_text("new")
    assert (root / "_site/index.html").read_text() == "new"
    assert not list(root.glob("._site-stage-*"))
    assert not list(root.glob("._site-backup-*"))


def test_builder_rejects_symbolic_output(tmp_path):
    root = tmp_path / "repo"
    root.mkdir()
    target = tmp_path / "target"
    target.mkdir()
    try:
        (root / "_site").symlink_to(target, target_is_directory=True)
    except OSError:
        pytest.skip("symlink creation is unavailable")
    with pytest.raises(ValueError):
        validate_output(root, "_site")
    assert target.is_dir()
