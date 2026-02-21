# -*- coding: utf-8 -*-
# Read the file in binary mode
with open('dpd-api.js', 'rb') as f:
    content = f.read()

# The bad pattern - curly single quotes (bytes)
bad = b".replace(/'/g, \xe2\x80\x98\xe2\x80\x99);"
good = b".replace(/'/g, ''');"

# Replace
content = content.replace(bad, good)

# Write back in binary mode
with open('dpd-api.js', 'wb') as f:
    f.write(content)

print('Fixed')
