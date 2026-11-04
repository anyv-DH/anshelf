# Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE.
"""Label a screenshot from the isolated skin UI test; no personal media is used."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SCALE = 2
canvas = Image.new('RGB', (1440 * SCALE, 1000 * SCALE), '#f5f0fa')
draw = ImageDraw.Draw(canvas)


def font(size, bold=False):
    return ImageFont.truetype('C:/Windows/Fonts/' + ('msyhbd.ttc' if bold else 'msyh.ttc'), size * SCALE)


def text(x, y, value, size=18, fill='#51415d', bold=False):
    draw.text((x * SCALE, y * SCALE), value, font=font(size, bold), fill=fill)


def box(rect, fill, outline=None, radius=18):
    draw.rounded_rectangle(tuple(round(v * SCALE) for v in rect), radius=radius * SCALE, fill=fill, outline=outline, width=2 * SCALE)


source = Image.open(ROOT / 'test-output/skin-ui/skin-settings.png').convert('RGB')
# Keep the complete real dialog; labels sit in the surrounding margin.
crop = source.crop((565, 245, 1288, 935))
crop = crop.resize((650 * SCALE, round(crop.height * 650 / crop.width) * SCALE), Image.Resampling.LANCZOS)
box((25, 25, 1415, 975), '#fcf9ff', '#e4d9ef', 30)
text(56, 49, '换上喜欢的底图，素材库也有自己的风格', 32, bold=True)
text(58, 108, '图片 · GIF · 视频，一次选择就能用。素材卡片保持清楚，不抢创作的主角。', 18, '#8c769b')
canvas.paste(crop, (395 * SCALE, 190 * SCALE))


def target(raw_x, raw_y):
    return 395 + (raw_x - 565) * 650 / 723, 190 + (raw_y - 245) * 650 / 723


def callout(n, title, lines, x, y, tx, ty, width=300):
    end_x = x + width if x < tx else x
    end_y = y + 43
    draw.line([(round(tx*SCALE),round(ty*SCALE)),(round(end_x*SCALE),round(end_y*SCALE))],fill='#ad88cf',width=3*SCALE)
    box((x,y,x+width,y+110),'#ffffff','#ded0ee',16)
    draw.ellipse(((tx-13)*SCALE,(ty-13)*SCALE,(tx+13)*SCALE,(ty+13)*SCALE),fill='#a781c9',outline='white',width=2*SCALE)
    text(tx-5,ty-12,str(n),15,'white',True)
    text(x+17,y+13,title,21,bold=True)
    for i,line in enumerate(lines):
        text(x+17,y+53+i*23,line,15,'#85708f')


callout(1,'选一张图，或一段视频',['支持 PNG / JPG / WebP / GIF','也能选择 MP4 / WebM 视频'],55,345,*target(755,552))
callout(2,'遮罩深浅，自己调',['往左，底图更明显','往右，文字与按钮更清楚'],1080,480,*target(1095,653))
callout(3,'动态想播就播',['视频静音循环，随时可暂停','切到后台时，自动暂停省资源'],55,645,*target(617,735))
callout(4,'想换回来？恢复默认',['取消皮肤，继续用暗色或暖色','不会删除你的原图片或视频'],1080,300,*target(1090,552))

box((395,850,1045,936),'#f0e8f9',None,16)
text(418,867,'只引用原文件，不复制大图和视频',20,bold=True)
text(418,902,'图片最多 40 MB · 视频最多 300 MB · 原文件移走后重新选择',15,'#8b729a')
text(58,946,'安安素材管理器 0.3.8 · 安屿动画',14,'#9a85a7')
output = ROOT / 'docs/images/annotated-skin.png'
canvas.resize((1440,1000),Image.Resampling.LANCZOS).save(output,optimize=True)
print(output)
