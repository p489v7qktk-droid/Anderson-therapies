import sys
try:
    from docx import Document
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'python-docx'])
    from docx import Document

doc = Document(r'c:\Users\sabri\OneDrive\Documents\AndersonTherapies\CV- January 2026.docx')
for para in doc.paragraphs:
    print(para.text)
