"""Place the original scanned ink in PDF using vector clipping, without redrawing it.

The JPEGs remain unchanged. Paper and empty margins are excluded by the PDF clip;
black handwriting is drawn over the blue seal, matching the supplied signed act.
"""
from functools import lru_cache
from pathlib import Path
from PIL import Image
from reportlab.lib.units import mm
from reportlab.platypus import Flowable


@lru_cache(maxsize=4)
def ink_geometry(path):
    with Image.open(path) as source:
        width, height = source.size
        pixels = source.load()
        runs = []
        left, top, right, bottom = width, height, 0, 0
        for y in range(height):
            start = None
            for x in range(width+1):
                value = pixels[x,y] if x < width else (255,255,255)
                ink = min(value[:3]) < 235
                if ink and start is None:
                    start = x
                elif not ink and start is not None:
                    runs.append((start,y,x-start))
                    left, top = min(left,start), min(top,y)
                    right, bottom = max(right,x), max(bottom,y+1)
                    start = None
    if not runs:
        raise ValueError('В изображении подписи или печати не найдено штрихов')
    return width,height,(left,top,right,bottom),tuple(runs)


def paint_original_ink(canvas, path, x, y, ink_width):
    width,height,(left,top,right,bottom),runs = ink_geometry(str(path))
    scale = ink_width/(right-left)
    canvas.saveState()
    canvas.setBlendMode('Multiply')
    canvas.translate(x,y)
    canvas.scale(scale,scale)
    clip = canvas.beginPath()
    for start,row,length in runs:
        clip.rect(start-left,bottom-row-1,length,1)
    canvas.clipPath(clip,stroke=0,fill=0)
    canvas.drawImage(str(path),-left,-(height-bottom),width=width,height=height)
    canvas.restoreState()
    return (bottom-top)*scale


class CompanyInkMark(Flowable):
    """One combined mark: seal behind the original signature, with no paper rectangles."""
    def __init__(self, asset_directory: Path):
        super().__init__()
        self.directory = asset_directory
        self.width = 59*mm
        self.height = 41*mm

    def draw(self):
        stamp = self.directory/'company-stamp.jpeg'
        signature = self.directory/'company-signature.jpeg'
        _,_,(left,top,right,bottom),_ = ink_geometry(str(stamp))
        stamp_width = 40*mm*(right-left)/(bottom-top)
        paint_original_ink(self.canv,stamp,0,0,stamp_width)
        _,_,(left,top,right,bottom),_ = ink_geometry(str(signature))
        signature_width = 49*mm
        signature_height = signature_width*(bottom-top)/(right-left)
        paint_original_ink(self.canv,signature,1*mm,(40*mm-signature_height)/2,signature_width)
