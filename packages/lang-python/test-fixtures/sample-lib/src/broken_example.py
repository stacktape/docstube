# Deliberately invalid Python: the extractor must report this file as an error entry
# without failing the batch.
def broken(:
    return "unreachable"
