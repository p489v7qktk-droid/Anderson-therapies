from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


def crop_to_square(image: Image.Image, left_pad: float = 0.08, top_pad: float = 0.06, right_pad: float = 0.08, bottom_pad: float = 0.12) -> Image.Image:
    width, height = image.size
    crop_width = min(width, height)
    crop_height = min(width, height)

    left = int(width * left_pad)
    top = int(height * top_pad)
    right = int(width - width * right_pad)
    bottom = int(height - height * bottom_pad)

    # Keep the crop balanced around the face area if the image is already close to square.
    if right - left > crop_width:
        extra = (right - left) - crop_width
        left += extra // 2
        right -= extra - extra // 2

    if bottom - top > crop_height:
        extra = (bottom - top) - crop_height
        top += extra // 2
        bottom -= extra - extra // 2

    # Ensure we stay within bounds.
    left = max(0, min(left, width - 1))
    top = max(0, min(top, height - 1))
    right = max(left + 1, min(right, width))
    bottom = max(top + 1, min(bottom, height))

    return image.crop((left, top, right, bottom)).resize((1000, 1000), Image.LANCZOS)


def main() -> None:
    parser = argparse.ArgumentParser(description='Crop a portrait to a square headshot for the homepage.')
    parser.add_argument('input', type=str, help='Source image path.')
    parser.add_argument('-o', '--output', type=str, default='Headshot.jpg', help='Output file path. Default: Headshot.jpg')
    parser.add_argument('--left', type=float, default=0.08, help='Left crop padding as fraction of width.')
    parser.add_argument('--top', type=float, default=0.06, help='Top crop padding as fraction of height.')
    parser.add_argument('--right', type=float, default=0.08, help='Right crop padding as fraction of width.')
    parser.add_argument('--bottom', type=float, default=0.12, help='Bottom crop padding as fraction of height.')
    args = parser.parse_args()

    source = Path(args.input)
    output = Path(args.output)

    image = Image.open(source)
    cropped = crop_to_square(image, args.left, args.top, args.right, args.bottom)
    cropped.save(output, quality=92, optimize=True)
    print(f'Created {output} from {source}')


if __name__ == '__main__':
    main()
