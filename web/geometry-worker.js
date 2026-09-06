import { findGrid, warp, estimateGrid, sharpness } from "./geometry.js";
import { prepareScan } from "./scan-analysis.js";
self.onmessage = ({ data }) => {
  try {
    let result;
    if (data.op === "detect")
      result = { ...findGrid(data.image), sharpness: sharpness(data.image) };
    else if (data.op === "warp" || data.op === "prepare") {
      const image = warp(data.image, data.corners, data.width, data.height);
      result =
        data.op === "prepare"
          ? prepareScan(image, data.type, data.rows, data.cols)
          : { image, meta: estimateGrid(image) };
    } else throw Error("Unknown image task");
    const transfer = result.image
      ? [
          result.image.data.buffer,
          ...(result.mask ? [result.mask.buffer, result.g.buffer] : []),
        ]
      : [];
    self.postMessage({ result }, transfer);
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
