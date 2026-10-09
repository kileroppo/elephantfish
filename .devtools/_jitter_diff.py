"""逐帧（相邻帧）差分：找出引擎应手那一刻，画面究竟哪一块在动。

- 相邻帧差分的包围盒若横跨整幅画布 → 整页位移（真正的「画面抖」）
- 若只在棋盘/转述台局部 → 是那个元素的动画
"""
import sys
from pathlib import Path
from PIL import Image, ImageChops

d = Path(sys.argv[1] if len(sys.argv) > 1 else 'shots/_jitter2')
files = sorted(d.glob('*.jpg'))
if not files:
    print('没有帧')
    raise SystemExit

ref = Image.open(files[0]).convert('RGB')
W, H = ref.size
print(f'画布 {W}x{H} · 帧数 {len(files)}')
print(f'{"帧":<6}{"变化%":>8}{"包围盒":>30}{"判定":>16}')

prev = ref
for p in files[1:]:
    img = Image.open(p).convert('RGB')
    diff = ImageChops.difference(prev, img).convert('L').point(lambda v: 255 if v > 10 else 0)
    bbox = diff.getbbox()
    changed = diff.histogram()[255]
    pct = changed / (W * H) * 100
    tag = ''
    if bbox:
        bw, bh = bbox[2] - bbox[0], bbox[3] - bbox[1]
        if bw > W * 0.85 and bh > H * 0.7:
            tag = '整页位移!'
        elif pct > 3:
            tag = '大范围'
        else:
            tag = '局部'
        print(f'{p.name:<6}{pct:>7.2f}%{str(bbox):>30}{tag:>16}')
    prev = img
