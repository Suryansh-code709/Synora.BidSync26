from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE

ppt = Presentation()
ppt.slide_width = Inches(13.333)
ppt.slide_height = Inches(7.5)

NAVY = RGBColor(10, 10, 10)
DARK = RGBColor(22, 22, 22)
TEAL = RGBColor(255, 128, 32)
GOLD = RGBColor(255, 168, 70)
WHITE = RGBColor(255, 255, 255)
MUTED = RGBColor(196, 196, 196)
LIGHT = RGBColor(245, 238, 230)
ACCENT = RGBColor(255, 102, 0)
ROSE = RGBColor(255, 146, 79)


def add_background(slide):
    slide.background.fill.solid()
    slide.background.fill.fore_color.rgb = NAVY


def add_top_band(slide, color=TEAL):
    band = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0), Inches(0), Inches(13.333), Inches(0.18))
    band.fill.solid()
    band.fill.fore_color.rgb = color
    band.line.fill.background()


def add_panel(slide, x, y, w, h, color=TEAL):
    panel = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x, y, w, h)
    panel.fill.solid()
    panel.fill.fore_color.rgb = DARK
    panel.line.color.rgb = color
    panel.line.width = 1
    return panel


def add_title(slide, title, subtitle=None):
    add_top_band(slide)
    pill = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(0.42), Inches(1.8), Inches(0.46))
    pill.fill.solid(); pill.fill.fore_color.rgb = TEAL; pill.line.fill.background()
    pill_tf = pill.text_frame
    p = pill_tf.paragraphs[0]
    p.text = 'BidSync'
    p.font.size = Pt(13)
    p.font.bold = True
    p.font.color.rgb = NAVY

    header = slide.shapes.add_textbox(Inches(0.8), Inches(1.0), Inches(8.5), Inches(0.8))
    p = header.text_frame.paragraphs[0]
    p.text = title
    p.font.size = Pt(28)
    p.font.bold = True
    p.font.color.rgb = WHITE

    if subtitle:
        sub = slide.shapes.add_textbox(Inches(0.8), Inches(1.8), Inches(10.0), Inches(0.5))
        p = sub.text_frame.paragraphs[0]
        p.text = subtitle
        p.font.size = Pt(15)
        p.font.color.rgb = MUTED


# Slide 1
slide = ppt.slides.add_slide(ppt.slide_layouts[6])
add_background(slide)
add_top_band(slide)

hero = slide.shapes.add_textbox(Inches(0.8), Inches(1.4), Inches(6.3), Inches(1.0))
p = hero.text_frame.paragraphs[0]
p.text = 'BidSync'
p.font.size = Pt(36)
p.font.bold = True
p.font.color.rgb = WHITE

sub = slide.shapes.add_textbox(Inches(0.8), Inches(2.4), Inches(7.5), Inches(0.7))
p = sub.text_frame.paragraphs[0]
p.text = 'Real-time auction platform for premium antique collectibles'
p.font.size = Pt(18)
p.font.color.rgb = LIGHT

badge = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.8), Inches(3.4), Inches(2.5), Inches(0.5))
badge.fill.solid(); badge.fill.fore_color.rgb = TEAL; badge.line.fill.background()
p = badge.text_frame.paragraphs[0]
p.text = 'Trust. Speed. Fairness.'
p.font.size = Pt(12)
p.font.bold = True
p.font.color.rgb = NAVY

right = add_panel(slide, Inches(8.3), Inches(1.2), Inches(4.0), Inches(4.4), TEAL)
right_tf = right.text_frame
for i, line in enumerate([
    'Live bids',
    '14/sec',
    'Idempotent',
    'Safe repeat requests',
    'Winner',
    'Resolved in real time'
]):
    p = right_tf.paragraphs[0] if i == 0 else right_tf.add_paragraph()
    p.text = line
    p.font.size = Pt(15 if i % 2 == 0 else 18)
    p.font.bold = i % 2 == 0
    p.font.color.rgb = WHITE if i % 2 == 0 else TEAL
    p.space_after = Pt(4)

info = slide.shapes.add_textbox(Inches(0.8), Inches(6.4), Inches(11.0), Inches(0.4))
p = info.text_frame.paragraphs[0]
p.text = 'Built for real-time bidding, trust, and premium marketplace experiences.'
p.font.size = Pt(11)
p.font.color.rgb = MUTED

# Slide 2
slide = ppt.slides.add_slide(ppt.slide_layouts[6])
add_background(slide)
add_title(slide, 'Problem Statement', 'The market gap in live auction systems')

cards = [
    ('Duplicate Bids', 'Repeated requests can be accepted multiple times and distort pricing.'),
    ('Stale State', 'Outdated auction data leads to wrong decisions and confusion.'),
    ('Wrong Winner', 'Inconsistent pricing logic creates unfair outcomes.'),
    ('Slow Updates', 'Users lose trust when the auction feed does not move in real time.')
]
for idx, (title, text) in enumerate(cards):
    x = Inches(0.9 + (idx % 2) * 5.4)
    y = Inches(2.3 + (idx // 2) * 2.0)
    card = add_panel(slide, x, y, Inches(4.5), Inches(1.7), TEAL if idx % 2 == 0 else ACCENT)
    tf = card.text_frame
    p = tf.paragraphs[0]
    p.text = title
    p.font.size = Pt(18)
    p.font.bold = True
    p.font.color.rgb = WHITE
    p2 = tf.add_paragraph()
    p2.text = text
    p2.font.size = Pt(11)
    p2.font.color.rgb = LIGHT

highlight = add_panel(slide, Inches(2.8), Inches(5.1), Inches(7.5), Inches(0.8), GOLD)
hf = highlight.text_frame
hf.paragraphs[0].text = 'Trust breaks when auctions fail under concurrency. BidSync fixes that.'
hf.paragraphs[0].font.size = Pt(17)
hf.paragraphs[0].font.bold = True
hf.paragraphs[0].font.color.rgb = NAVY

# Slide 3
slide = ppt.slides.add_slide(ppt.slide_layouts[6])
add_background(slide)
add_title(slide, 'Why BidSync?', 'A premium, real-time auction experience')

pillars = [
    ('Trust', 'Idempotent bid protection and validation keep the system fair and reliable.'),
    ('Speed', 'Real-time updates create frictionless bidding with no page reload.'),
    ('Luxury UX', 'Premium antique catalog and polished bidding flow elevate the experience.')
]
for idx, (title, text) in enumerate(pillars):
    x = Inches(0.9 + idx * 4.2)
    card = add_panel(slide, x, Inches(2.4), Inches(3.7), Inches(2.6), TEAL if idx == 0 else ACCENT if idx == 1 else ROSE)
    tf = card.text_frame
    p = tf.paragraphs[0]
    p.text = title
    p.font.size = Pt(22)
    p.font.bold = True
    p.font.color.rgb = WHITE
    p2 = tf.add_paragraph(); p2.text = text; p2.font.size = Pt(12); p2.font.color.rgb = LIGHT

# Slide 4
slide = ppt.slides.add_slide(ppt.slide_layouts[6])
add_background(slide)
add_title(slide, 'Core Features', 'Everything that makes the system feel real and production-ready')
features = [
    ('Live Auction Feed', 'Instant bid updates via SSE without refresh.'),
    ('Bid Validation', 'Minimum increments and valid-state checks.'),
    ('Idempotency Keys', 'Prevents duplicate logical bids and resubmits safely.'),
    ('Winner Resolution', 'Final bidder and winning amount shown after close.'),
    ('Premium Inventory', 'Antiques, paintings, sculptures, and rare goods.'),
    ('Stress-Ready Logic', 'Built to function correctly under concurrent bidding pressure.')
]
for idx, (title, text) in enumerate(features):
    row = idx // 3
    col = idx % 3
    x = Inches(0.9 + col * 4.1)
    y = Inches(2.4 + row * 1.7)
    card = add_panel(slide, x, y, Inches(3.7), Inches(1.45), TEAL if idx % 2 == 0 else ACCENT)
    tf = card.text_frame
    p = tf.paragraphs[0]
    p.text = title
    p.font.size = Pt(17)
    p.font.bold = True
    p.font.color.rgb = WHITE
    p2 = tf.add_paragraph(); p2.text = text; p2.font.size = Pt(10.5); p2.font.color.rgb = LIGHT

# Slide 5
slide = ppt.slides.add_slide(ppt.slide_layouts[6])
add_background(slide)
add_title(slide, 'Solution Architecture', 'A clean structure for live bidding and fair outcomes')

boxes = [
    ('Frontend', 'Next.js + React', Inches(1.0), Inches(2.5), Inches(2.5), Inches(1.5)),
    ('API Layer', 'Go backend', Inches(4.0), Inches(2.5), Inches(2.7), Inches(1.5)),
    ('Auction Engine', 'Validation + state', Inches(7.2), Inches(2.5), Inches(2.6), Inches(1.5)),
    ('Live Updates', 'SSE stream', Inches(10.2), Inches(2.5), Inches(2.0), Inches(1.5)),
]
for name, desc, x, y, w, h in boxes:
    b = add_panel(slide, x, y, w, h, TEAL if name in ('Frontend', 'Auction Engine') else ACCENT)
    tf = b.text_frame
    p = tf.paragraphs[0]
    p.text = name
    p.font.size = Pt(16)
    p.font.bold = True
    p.font.color.rgb = WHITE
    p2 = tf.add_paragraph(); p2.text = desc; p2.font.size = Pt(11); p2.font.color.rgb = LIGHT

summary = add_panel(slide, Inches(1.5), Inches(4.7), Inches(10.2), Inches(1.1), GOLD)
summary_tf = summary.text_frame
summary_tf.paragraphs[0].text = 'The design separates user experience, bid validation, and live state management to keep auction outcomes fair and correct.'
summary_tf.paragraphs[0].font.size = Pt(17)
summary_tf.paragraphs[0].font.bold = True
summary_tf.paragraphs[0].font.color.rgb = NAVY

# Slide 6
slide = ppt.slides.add_slide(ppt.slide_layouts[6])
add_background(slide)
add_title(slide, 'Conclusion', 'Why this stands out to judges')

final_box = add_panel(slide, Inches(1.0), Inches(2.2), Inches(11.2), Inches(3.0), TEAL)
text_frame = final_box.text_frame
bullets = [
    'BidSync is more than a basic auction demo: it focuses on correctness under concurrency.',
    'It combines fair bid validation, idempotency, live updates, and premium product presentation.',
    'This creates a real auction feel with trust, speed, and polished user experience.'
]
for i, line in enumerate(bullets):
    p = text_frame.paragraphs[0] if i == 0 else text_frame.add_paragraph()
    p.text = line
    p.font.size = Pt(20)
    p.font.color.rgb = WHITE
    p.space_after = Pt(12)

end = slide.shapes.add_textbox(Inches(1.2), Inches(6.1), Inches(11.0), Inches(0.5))
p = end.text_frame.paragraphs[0]
p.text = 'Built to impress: real-time fairness, premium design, and production-minded auction logic.'
p.font.size = Pt(14)
p.font.bold = True
p.font.color.rgb = GOLD

output_path = r'C:\Users\Acer\Desktop\BidSync_Presentation_ThemeMatch.pptx'
ppt.save(output_path)
print(output_path)
