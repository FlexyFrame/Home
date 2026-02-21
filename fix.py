# -*- coding: utf-8 -*-
import codecs

# Read the file
with open('dpd-api.js', 'r', encoding='utf-8') as f:
    content = f.read()

# The bad pattern - using unicode escapes to handle special characters
bad = ".replace(/'/g, '\u2018\u2019');"
good = ".replace(/'/g, ''');"

# Replace
content = content.replace(bad, good)

# Write back
with open('dpd-api.js', 'w', encoding='utf-8') as f:
    f.write(content)

print('Fixed')
