import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePreviewVideoUrl } from '../pages-app/lib/preview-video';

test('turns supported YouTube links into privacy-enhanced embeds', () => {
  assert.deepEqual(parsePreviewVideoUrl('https://youtu.be/dQw4w9WgXcQ'), {
    url: 'https://youtu.be/dQw4w9WgXcQ',
    embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
  });
  assert.equal(
    parsePreviewVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')?.embedUrl,
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
  );
  assert.equal(
    parsePreviewVideoUrl('https://youtube.com/shorts/dQw4w9WgXcQ')?.embedUrl,
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
  );
});

test('keeps the YouTube video optional and rejects other link types', () => {
  assert.equal(parsePreviewVideoUrl(''), null);
  assert.throws(() => parsePreviewVideoUrl('https://example.com/video.mp4'), /YouTube/);
  assert.throws(() => parsePreviewVideoUrl('http://youtube.com/watch?v=dQw4w9WgXcQ'), /HTTPS/);
});
