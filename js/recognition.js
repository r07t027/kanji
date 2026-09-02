// 手書き認識（Google Input Tools API）連携モジュール

export async function recognizeChar(strokes) {
  const ink = strokes.map(stroke => [
    stroke.map(pt => pt[0]),
    stroke.map(pt => pt[1])
  ]);

  const res = await fetch('https://inputtools.google.com/request?ime=handwriting&app=autho&dbg=1&cs=1&oe=UTF-8', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{
        writing_guide: { writing_area_width: 260, writing_area_height: 260 },
        pre_context: '',
        max_num_results: 5,
        language: 'ja',
        ink: ink
      }]
    })
  });
  const data = await res.json();
  return (data[1] && data[1][0] && data[1][0][1]) || [];
}
