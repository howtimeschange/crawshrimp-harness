"""The install gate runs both ONNX backbones and the offline OCR engine."""
import sys
from pathlib import Path

import numpy as np
import zxingcpp
from PIL import Image
from rapidocr_onnxruntime import RapidOCR

from .inference import Backbone


def main():
    bundle = Path(sys.argv[1])
    for size in (224, 448):
        result = Backbone(bundle, size).encode(Image.new("RGB", (size, size), "white"))
        if not np.isfinite(result).all() or result.shape[-1] != 384:
            raise ValueError("Invalid DINO output")
    RapidOCR(intra_op_num_threads=1, inter_op_num_threads=1)
    zxingcpp.read_barcodes(Image.new("RGB", (100, 100), "white"))
    print("Bala ONNX and OCR ready")


if __name__ == "__main__":
    main()
