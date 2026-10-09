"""差分热力图：把两帧之间发生变化的像素画出来，看看是「哪一圈」在变。"""
import sys
from pathlib import Path
from PIL import Image, ImageChops

d = Path(sys.argv[1] if len(sys.argv) > 1 else 'shots/_jitter2')
a, b = sys.argv[2].split(',')
out = d / f'_heat_{a}_{b}.png'

A = Image.open(d / f'{a}.jpg').convert('RGB')
B = Image.open(d / f'{b}.jpg').convert('RGB')
diff = ImageChops.difference(A, B).convert('L').point(lambda v: 255 if v > 10 else 0)

# 变化像素染红叠在原图上
heat = A.copy()
red = Image.new('RGB', A.size, (255, 0, 0))
heat.paste(red, (0, 0), diff)

# 同时打印变化像素按「到棋盘边缘的距离」分布，判断是不是边缘一圈在变
print(f'{a} vs {b}: 变化像素 {diff.histogram()[255]}')
heat = heat.resize((heat.width // 2, heat.height // 2))
heat.save(out)
print('热力图:', out)

# 按行/列统计变化像素数，找出变化的集中区域
import collections
px = diff.load()
W, H = diff.size
rows = collections.Counter()
cols = collections.Counter()
for y in range(0, H, 2):
    for x in range(0, W, 2):
        if px[x, y]:
            rows[y] += 1
            cols[x] += 1
top_rows = rows.most_common(6)
top_cols = cols.most_common(6)
print('变化最多的行(y, 数量):', top_rows)
print('变化最多的列(x, 数量):', top_cols)
