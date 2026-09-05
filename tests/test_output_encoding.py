"""Unicode rendering must survive redirected Windows output in every mode."""

import io
from types import SimpleNamespace

import colorama
import pytest

from gridsolver.solver import logger


@pytest.mark.parametrize("mode", tuple(logger.Colouring))
def test_windows_output_modes_reconfigure_legacy_stream_without_replacing_it(monkeypatch, mode):
    buffer = io.BytesIO()
    output = io.TextIOWrapper(buffer, encoding="cp1252", errors="strict")
    configured = []
    monkeypatch.setattr(logger, "sys", SimpleNamespace(platform="win32", stdout=output))
    monkeypatch.setattr(logger, "C", logger.C)
    monkeypatch.setattr(logger, "_restore_colorama_streams", lambda: None)
    monkeypatch.setattr(colorama, "just_fix_windows_console", lambda: None)
    monkeypatch.setattr(logger.logging, "basicConfig", lambda **kwargs: configured.append(kwargs))
    try:
        # Repeated mode configuration must not close or replace stdout's buffer.
        logger.set_colouring(mode)
        logger.set_colouring(mode)
        assert output.encoding == "utf-8"
        assert not buffer.closed
        output.write("┏12┓\n┗34┛\n")
        output.flush()
        assert buffer.getvalue().decode("utf-8").splitlines() == ["┏12┓", "┗34┛"]
        assert len(configured) == 2
        if mode is not logger.Colouring.Rich:
            assert all(settings["stream"] is output for settings in configured)
    finally:
        output.detach()
