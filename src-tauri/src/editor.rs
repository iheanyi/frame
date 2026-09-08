use crate::{command, output_timeout, owned_path, resolve, tool};
use serde::{Deserialize, Serialize};
use std::{path::Path, time::Duration};
#[derive(Serialize, Deserialize, Clone)]
pub struct Focus {
    pub time: f64,
    pub duration: f64,
    pub x: f64,
    pub y: f64,
    pub zoom: f64,
}
#[derive(Serialize, Deserialize, Clone)]
pub struct Tap {
    pub time: f64,
    pub x: f64,
    pub y: f64,
    #[serde(default)]
    pub duration: Option<f64>,
}
#[derive(Serialize, Deserialize, Default, Clone)]
pub struct TapStyle {
    pub color: Option<String>,
    pub size: Option<f64>,
    pub bloom: Option<f64>,
}
#[derive(Serialize, Deserialize, Default, Clone)]
pub struct Edits {
    pub focus: Vec<Focus>,
    pub taps: Vec<Tap>,
    #[serde(default, rename = "tapStyle")]
    pub tap_style: Option<TapStyle>,
    #[serde(default)]
    pub segments: Option<Vec<Segment>>,
}
#[derive(Serialize, Deserialize, Clone)]
pub struct Segment {
    pub start: f64,
    pub end: f64,
}
#[derive(Serialize)]
pub struct MediaInfo {
    pub width: u32,
    pub height: u32,
    pub duration: f64,
    pub audio: bool,
}
pub fn inspect(app: &tauri::AppHandle, p: &Path) -> Result<MediaInfo, String> {
    let ffmpeg = tool(app, "ffmpeg")?;
    let sibling = ffmpeg.with_file_name(if cfg!(windows) {
        "ffprobe.exe"
    } else {
        "ffprobe"
    });
    let probe = if sibling.exists() {
        sibling
    } else {
        resolve("ffprobe", "").ok_or(
            "FFprobe is required for the timeline. Choose an FFmpeg package that includes it.",
        )?
    };
    let mut c = command(probe);
    c.args([
        "-v",
        "error",
        "-show_entries",
        "stream=codec_type,width,height,duration:format=duration",
        "-of",
        "json",
    ])
    .arg(p);
    let value: serde_json::Value =
        serde_json::from_slice(&output_timeout(c, Duration::from_secs(15))?)
            .map_err(|e| e.to_string())?;
    let streams = value["streams"].as_array().ok_or("No media streams")?;
    let video = streams
        .iter()
        .find(|v| v["codec_type"] == "video")
        .ok_or("No video stream")?;
    let duration = value["format"]["duration"]
        .as_str()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0.);
    Ok(MediaInfo {
        width: video["width"].as_u64().unwrap_or(1) as u32,
        height: video["height"].as_u64().unwrap_or(1) as u32,
        duration,
        audio: streams.iter().any(|v| v["codec_type"] == "audio"),
    })
}
#[tauri::command]
pub async fn media_info(app: tauri::AppHandle, path: String) -> Result<MediaInfo, String> {
    tauri::async_runtime::spawn_blocking(move || inspect(&app, &owned_path(&app, &path)?))
        .await
        .map_err(|e| e.to_string())?
}
pub fn validate(edits: &Edits) -> Result<(), String> {
    if let Some(style) = &edits.tap_style {
        if style.color.as_ref().is_some_and(|c| c.len()!=7 || !c.starts_with('#') || !c[1..].bytes().all(|b| b.is_ascii_hexdigit()))
          || style.size.is_some_and(|n| !n.is_finite() || !(12.0..=100.0).contains(&n))
          || style.bloom.is_some_and(|n| !n.is_finite() || !(0.0..=1.0).contains(&n)) {
            return Err("Invalid tap styling.".into());
        }
    }
    if let Some(segments) = &edits.segments {
        if segments.is_empty() || segments.len() > 100 {
            return Err("Keep between 1 and 100 video segments.".into());
        }
        let mut previous = 0.;
        for segment in segments {
            if !segment.start.is_finite()
                || !segment.end.is_finite()
                || segment.start < previous
                || segment.end - segment.start < 0.001
            {
                return Err("Video segments must be ordered, non-overlapping, and have a positive duration.".into());
            }
            previous = segment.end;
        }
    }
    if edits.focus.len() > 50 || edits.taps.len() > 200 {
        return Err("Use at most 50 focus points and 200 tap highlights.".into());
    }
    let unit = |n: f64| n.is_finite() && (0.0..=1.0).contains(&n);
    for f in &edits.focus {
        if !f.time.is_finite()
            || f.time < 0.
            || !f.duration.is_finite()
            || !(0.8..=20.).contains(&f.duration)
            || !unit(f.x)
            || !unit(f.y)
            || !f.zoom.is_finite()
            || !(1.0..=3.0).contains(&f.zoom)
        {
            return Err("Invalid focus point.".into());
        }
    }
    for t in &edits.taps {
        if !t.time.is_finite() || t.time < 0. || !unit(t.x) || !unit(t.y) || t.duration.is_some_and(|d| !d.is_finite() || !(0.1..=20.).contains(&d)) {
            return Err("Invalid tap highlight.".into());
        }
    }
    for (i, f) in edits.focus.iter().enumerate() {
        if edits
            .focus
            .iter()
            .skip(i + 1)
            .any(|g| f.time < g.time + g.duration && g.time < f.time + f.duration)
        {
            return Err("Focus points cannot overlap. Move them apart on the timeline.".into());
        }
    }
    Ok(())
}
#[tauri::command]
pub fn load_edits(app: tauri::AppHandle, path: String) -> Result<Edits, String> {
    let p = owned_path(&app, &path)?.with_extension("frame.json");
    if !p.exists() {
        return Ok(Edits::default());
    }
    serde_json::from_slice(&std::fs::read(p).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn save_edits(app: tauri::AppHandle, path: String, edits: Edits) -> Result<(), String> {
    validate(&edits)?;
    let p = owned_path(&app, &path)?.with_extension("frame.json");
    std::fs::write(
        p,
        serde_json::to_vec_pretty(&edits).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}
pub fn effects(edits: &Edits, info: &MediaInfo, start: f64, base: &str) -> Result<String, String> {
    validate(edits)?;
    let mut graph = String::new();
    let mut input = "0:v".to_string();
    let style=edits.tap_style.clone().unwrap_or_default();
    let color=style.color.as_deref().unwrap_or("#ffe0bb");
    let red=u8::from_str_radix(&color[1..3],16).unwrap();
    let green=u8::from_str_radix(&color[3..5],16).unwrap();
    let blue=u8::from_str_radix(&color[5..7],16).unwrap();
    let radius=style.size.unwrap_or(30.);
    let bloom=style.bloom.unwrap_or(0.5);
    let side=((radius*6.).ceil() as u32+1)/2*2;
    let center=side as f64/2.;
    for (i,t) in edits.taps.iter().enumerate() {
        let a=t.time-start;
        let duration=t.duration.unwrap_or(0.45);
        let b=a+duration;
        if b<=0. { continue; }
        let x=t.x*info.width as f64-center;
        let y=t.y*info.height as f64-center;
        let glow=(radius*bloom).max(1.);
        let distance=format!("abs(hypot(X-{center},Y-{center})-{radius}*(0.75+0.5*T/{duration}))");
        let alpha=format!("(1-min(T/{duration},1))*min(255,if(lt({distance},2),230,0)+{bloom}*150*exp(-pow({distance}/{glow},2)))");
        graph.push_str(&format!("color=c=black@0:s={side}x{side}:r=60:d={duration},format=rgba,geq=r={red}:g={green}:b={blue}:a='{alpha}',setpts=PTS+{a}/TB[ring{i}];[{input}][ring{i}]overlay=x={x}:y={y}:enable='between(t,{a},{b})':eof_action=pass:repeatlast=0[tapped{i}];"));
        input=format!("tapped{i}");
    }
    if !edits.focus.is_empty() {
        let time = format!("(on/60+{start})");
        let mut zoom = "1".to_string();
        let mut x = "0.5".to_string();
        let mut y = "0.5".to_string();
        for f in edits.focus.iter().rev() {
            let a = f.time;
            let b = a + f.duration;
            let ease=format!("pow(sin(PI/2*min(max(({time}-{a})/0.35,0),1)),2)*pow(sin(PI/2*min(max(({b}-{time})/0.35,0),1)),2)");
            zoom = format!(
                "if(between({time},{a},{b}),1+{}*{ease},{zoom})",
                f.zoom - 1.
            );
            x = format!("if(between({time},{a},{b}),{},{x})", f.x);
            y = format!("if(between({time},{a},{b}),{},{y})", f.y);
        }
        graph.push_str(&format!("[{input}]fps=60,zoompan=z='{zoom}':x='iw*({x})-iw/zoom/2':y='ih*({y})-ih/zoom/2':d=1:s={}x{}:fps=60[focused];",info.width,info.height));
        input = "focused".into();
    }
    graph.push_str(&format!("[{input}]{base}[outv]"));
    Ok(graph)
}

/// Apply effects in source time, then splice matching video and audio intervals.
pub fn splice_effects(
    edits: &Edits,
    info: &MediaInfo,
    start: f64,
    end: Option<f64>,
    base: &str,
) -> Result<(String, bool), String> {
    let original = effects(edits, info, start, base)?;
    let Some(segments) = &edits.segments else {
        return Ok((original, false));
    };
    if segments.iter().any(|s| s.end > info.duration + 0.001) {
        return Err("Video segments must stay inside the original clip.".into());
    }
    let limit = end.unwrap_or(info.duration);
    let kept: Vec<_> = segments
        .iter()
        .filter_map(|s| {
            let a = s.start.max(start);
            let b = s.end.min(limit);
            (b - a > 0.001).then_some((a - start, b - start))
        })
        .collect();
    if kept.is_empty() {
        return Err("The trim does not contain any kept video segments.".into());
    }
    let mut graph = original.strip_suffix("[outv]").unwrap().to_string();
    graph.push_str("[composed];[composed]split=");
    graph.push_str(&kept.len().to_string());
    for i in 0..kept.len() {
        graph.push_str(&format!("[v{i}]"));
    }
    graph.push(';');
    if info.audio {
        graph.push_str(&format!("[0:a]asplit={}", kept.len()));
        for i in 0..kept.len() {
            graph.push_str(&format!("[a{i}]"));
        }
        graph.push(';');
    }
    for (i, (a, b)) in kept.iter().enumerate() {
        graph.push_str(&format!(
            "[v{i}]trim=start={a}:end={b},setpts=PTS-STARTPTS[cutv{i}];"
        ));
        if info.audio {
            graph.push_str(&format!(
                "[a{i}]atrim=start={a}:end={b},asetpts=PTS-STARTPTS[cuta{i}];"
            ));
        }
    }
    for i in 0..kept.len() {
        graph.push_str(&format!("[cutv{i}]"));
        if info.audio {
            graph.push_str(&format!("[cuta{i}]"));
        }
    }
    graph.push_str(&format!(
        "concat=n={}:v=1:a={}[outv]{}",
        kept.len(),
        if info.audio { 1 } else { 0 },
        if info.audio { "[outa]" } else { "" }
    ));
    Ok((graph, info.audio))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn splice_renders_matching_video_and_audio_durations() {
        let Some(ffmpeg) = resolve("ffmpeg", "") else {
            return;
        };
        let Some(ffprobe) = resolve("ffprobe", "") else {
            return;
        };
        for audio in [false, true] {
            let edits = Edits {
            tap_style: None,
                focus: vec![],
                taps: vec![],
                segments: Some(vec![
                    Segment {
                        start: 0.,
                        end: 0.5,
                    },
                    Segment {
                        start: 2.,
                        end: 2.5,
                    },
                ]),
            };
            let (graph, mapped_audio) = splice_effects(
                &edits,
                &MediaInfo {
                    width: 160,
                    height: 320,
                    duration: 3.,
                    audio,
                },
                0.,
                None,
                "setsar=1",
            )
            .unwrap();
            assert_eq!(mapped_audio, audio);
            let path =
                std::env::temp_dir().join(format!("frame-splice-{}-{audio}.mp4", crate::stamp()));
            let input = std::env::temp_dir().join(format!(
                "frame-splice-source-{}-{audio}.mp4",
                crate::stamp()
            ));
            let mut c = command(&ffmpeg);
            c.args([
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=160x320:rate=30:duration=3",
            ]);
            if audio {
                c.args([
                    "-f",
                    "lavfi",
                    "-i",
                    "sine=frequency=440:duration=3",
                    "-c:a",
                    "aac",
                ]);
            }
            c.args(["-c:v", "libx264", "-pix_fmt", "yuv420p"])
                .arg(&input);
            output_timeout(c, Duration::from_secs(30)).unwrap();
            let mut c = command(&ffmpeg);
            c.args(["-v", "error", "-i"]).arg(&input).args([
                "-filter_complex",
                &graph,
                "-map",
                "[outv]",
            ]);
            if audio {
                c.args(["-map", "[outa]", "-c:a", "aac"]);
            }
            c.args(["-c:v", "libx264", "-pix_fmt", "yuv420p"])
                .arg(&path);
            output_timeout(c, Duration::from_secs(30))
                .expect("Splice filter must encode real streams");
            let mut probe = command(&ffprobe);
            probe
                .args([
                    "-v",
                    "error",
                    "-show_entries",
                    "stream=codec_type,duration",
                    "-of",
                    "json",
                ])
                .arg(&path);
            let data: serde_json::Value =
                serde_json::from_slice(&output_timeout(probe, Duration::from_secs(15)).unwrap())
                    .unwrap();
            let streams = data["streams"].as_array().unwrap();
            assert_eq!(streams.len(), if audio { 2 } else { 1 });
            for stream in streams {
                let duration: f64 = stream["duration"].as_str().unwrap().parse().unwrap();
                assert!(
                    (duration - 1.).abs() < 0.06,
                    "Spliced stream duration was {duration}"
                );
            }
            if audio {
                let mut decode = command(&ffmpeg);
                decode.args(["-v", "error", "-i"]).arg(&path).args([
                    "-map",
                    "0:a",
                    "-f",
                    "f32le",
                    "-acodec",
                    "pcm_f32le",
                    "-",
                ]);
                let pcm = output_timeout(decode, Duration::from_secs(15)).unwrap();
                assert!(
                    pcm.chunks_exact(4)
                        .any(|bytes| f32::from_le_bytes(bytes.try_into().unwrap()).abs() > 0.01),
                    "Spliced audio must contain actual sound, not silence"
                );
            }
        }
    }
    #[test]
    fn reject_overlapping_focus() {
        let f = Focus {
            time: 1.,
            duration: 2.,
            x: 0.5,
            y: 0.5,
            zoom: 1.7,
        };
        let e = Edits {
            tap_style: None,
            segments: None,
            focus: vec![f.clone(), f],
            taps: vec![],
        };
        assert!(validate(&e).is_err());
    }
    #[test]
    fn effects_use_original_timeline_after_trim() {
        let e = Edits {
            tap_style: None,
            segments: None,
            focus: vec![Focus {
                time: 4.,
                duration: 2.,
                x: 0.3,
                y: 0.7,
                zoom: 2.,
            }],
            taps: vec![Tap {
                duration: None,
                time: 5.,
                x: 0.2,
                y: 0.8,
            }],
        };
        let g = effects(
            &e,
            &MediaInfo {
                width: 720,
                height: 1600,
                duration: 10.,
                audio: true,
            },
            3.,
            "setsar=1",
        )
        .unwrap();
        assert!(g.contains("on/60+3"));
        assert!(g.contains("between(t,2,2.45)"));
        assert!(g.ends_with("[outv]"));
    }
    #[test]
    fn focus_and_tap_filters_render_real_video() {
        let Some(ffmpeg) = resolve("ffmpeg", "") else {
            return;
        };
        let path = std::env::temp_dir().join(format!("frame-effects-{}.mp4", crate::stamp()));
        let e = Edits {
            tap_style: None,
            segments: None,
            focus: vec![Focus {
                time: 0.5,
                duration: 1.5,
                x: 0.4,
                y: 0.6,
                zoom: 1.8,
            }],
            taps: vec![Tap {
                duration: None,
                time: 1.,
                x: 0.4,
                y: 0.6,
            }],
        };
        let g = effects(
            &e,
            &MediaInfo {
                width: 160,
                height: 320,
                duration: 3.,
                audio: false,
            },
            0.,
            "scale=180:360,pad=240:400:30:20:color=#c6b8a6",
        )
        .unwrap();
        let mut c = command(ffmpeg);
        c.args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-n",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=160x320:rate=30:duration=3",
            "-filter_complex",
            &g,
            "-map",
            "[outv]",
            "-t",
            "3",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
        ])
        .arg(&path);
        output_timeout(c, Duration::from_secs(30))
            .expect("Focus and tap filter graph must encode successfully");
        assert!(std::fs::metadata(&path).unwrap().len() > 1000);
    }
}
