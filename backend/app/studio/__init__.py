"""Cvideo Studio: long-form editing by words (the Cut room), served beside Cvideo.

Studio shares Cvideo's backend process and ffmpeg, but none of its database: every project
is a folder under settings.STUDIO_DIR whose project.json is the single source of truth.
"""
