import csv
import json
import tempfile
import unittest
from pathlib import Path
from corpus.motion_tracks import midv, quad, smartdoc


class MotionTrackTests(unittest.TestCase):
    def test_quad_validation(self):
        self.assertEqual(quad([[0, 0], [0, 10], [10, 10], [10, 0]]), [[0., 0.], [10., 0.], [10., 10.], [0., 10.]])
        for points in ([], [[0, 0]] * 4, [[0, 0], [10, 10], [10, 0], [0, 10]], [[0, 0], [1, 0], [float('nan'), 1], [0, 1]]):
            with self.assertRaises(ValueError):
                quad(points)

    def test_smartdoc_frame_order_and_corner_order(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'metadata.csv'
            fields = ['bg_name', 'model_name', 'image_path', 'frame_index'] + [f'{p}_{d}' for p in ('tl', 'tr', 'br', 'bl') for d in ('x', 'y')]
            with path.open('w', newline='') as stream:
                writer = csv.DictWriter(stream, fieldnames=fields)
                writer.writeheader()
                for index in (2, 1):
                    writer.writerow(dict(zip(fields, ['bg1', 'paper1', f'{index}.jpeg', index, 0, 0, 10, 0, 10, 10, 0, 10])))
            clips = smartdoc(path)
            self.assertEqual([f['index'] for f in clips[0]['frames']], [1, 2])
            self.assertEqual(clips[0]['frames'][0]['corners'][1], [10., 0.])

    def test_midv_keeps_only_frame_geometry(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)
            (path / 'frame01.json').write_text(json.dumps({'quad': [[0, 0], [10, 0], [10, 10], [0, 10]], 'private_field': 'not copied'}))
            clips = midv(path)
            self.assertNotIn('private_field', json.dumps(clips))
            self.assertEqual(clips[0]['frames'][0]['frame'], 'frame01.tif')
            (path / 'bad.json').write_text('{}')
            with self.assertRaises(ValueError):
                midv(path)
