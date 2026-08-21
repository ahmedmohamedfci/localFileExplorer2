use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Mutex;

/// Best-effort media duration in milliseconds.
/// Order: container parsers → ffprobe → MediaInfo → Windows Shell (PowerShell COM).
pub fn probe_duration_ms(path: &Path) -> Option<f64> {
    if let Some(ms) = probe_container(path) {
        return Some(ms);
    }
    if let Some(ms) = probe_ffprobe(path) {
        return Some(ms);
    }
    if let Some(ms) = probe_mediainfo(path) {
        return Some(ms);
    }
    #[cfg(windows)]
    {
        return probe_shell_powershell(path);
    }
    #[cfg(not(windows))]
    {
        None
    }
}

fn probe_container(path: &Path) -> Option<f64> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())?;

    match ext.as_str() {
        "mp4" | "m4v" | "m4a" | "mov" | "3gp" => probe_mp4(path),
        "mkv" | "webm" => probe_mkv(path),
        "mp3" => probe_mp3(path),
        "wav" => probe_wav(path),
        "flac" => probe_flac(path),
        _ => None,
    }
}

fn run_hidden(cmd: &str, args: &[&str]) -> Option<std::process::Output> {
    let mut c = Command::new(cmd);
    c.args(args).stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c.output().ok()
}

fn probe_ffprobe(path: &Path) -> Option<f64> {
    let output = run_hidden(
        "ffprobe",
        &[
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            path.to_str()?,
        ],
    )?;
    if !output.status.success() {
        return None;
    }
    parse_seconds_to_ms(String::from_utf8_lossy(&output.stdout).trim())
}

fn probe_mediainfo(path: &Path) -> Option<f64> {
    let output = run_hidden(
        "mediainfo",
        &["--Inform=General;%Duration%", path.to_str()?],
    )?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let ms: f64 = text.parse().ok()?;
    if ms.is_finite() && ms >= 0.0 {
        Some(ms)
    } else {
        None
    }
}

fn parse_seconds_to_ms(s: &str) -> Option<f64> {
    let secs: f64 = s.parse().ok()?;
    if secs.is_finite() && secs >= 0.0 {
        Some(secs * 1000.0)
    } else {
        None
    }
}

/// Windows Explorer "Length" column via Shell.Application (locale-aware scan).
#[cfg(windows)]
fn probe_shell_powershell(path: &Path) -> Option<f64> {
    // Cache which details column index is Duration/Length for this process.
    static COL: Mutex<Option<i32>> = Mutex::new(None);

    let folder = path.parent()?.to_str()?.replace('\'', "''");
    let name = path.file_name()?.to_str()?.replace('\'', "''");

    let col_hint = COL.lock().ok().and_then(|g| *g);
    let col_expr = match col_hint {
        Some(c) => c.to_string(),
        None => "-1".into(),
    };

    let script = format!(
        r#"
$ErrorActionPreference='Stop'
$folder='{folder}'
$name='{name}'
$colHint={col_expr}
$shell=New-Object -ComObject Shell.Application
$ns=$shell.NameSpace($folder)
if(-not $ns){{ exit 2 }}
$item=$ns.ParseName($name)
if(-not $item){{ exit 3 }}
function Parse-Len([string]$v) {{
  if([string]::IsNullOrWhiteSpace($v)){{ return $null }}
  $v=$v.Trim()
  if($v -match '^(\d+):(\d{{2}}):(\d{{2}})(\.\d+)?$'){{
    return ([int]$Matches[1]*3600+[int]$Matches[2]*60+[int]$Matches[3])*1000
  }}
  if($v -match '^(\d+):(\d{{2}})(\.\d+)?$'){{
    return ([int]$Matches[1]*60+[int]$Matches[2])*1000
  }}
  return $null
}}
$col=$colHint
if($col -lt 0){{
  for($i=0; $i -le 320; $i++){{
    $hdr=$ns.GetDetailsOf($null,$i)
    if($hdr -eq 'Length' -or $hdr -eq 'Duration' -or $hdr -eq 'Länge' -or $hdr -eq 'Dauer'){{
      $col=$i; break
    }}
  }}
}}
if($col -lt 0){{ exit 4 }}
$raw=$ns.GetDetailsOf($item,$col)
$ms=Parse-Len $raw
if($null -eq $ms){{ exit 5 }}
Write-Output ("COL="+$col)
Write-Output ("MS="+$ms)
"#
    );

    let output = run_hidden(
        "powershell",
        &["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &script],
    )?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut ms_out = None;
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("COL=") {
            if let Ok(c) = rest.trim().parse::<i32>() {
                if let Ok(mut g) = COL.lock() {
                    *g = Some(c);
                }
            }
        }
        if let Some(rest) = line.strip_prefix("MS=") {
            if let Ok(ms) = rest.trim().parse::<f64>() {
                if ms.is_finite() && ms >= 0.0 {
                    ms_out = Some(ms);
                }
            }
        }
    }
    ms_out
}

fn probe_mp4(path: &Path) -> Option<f64> {
    let mut f = File::open(path).ok()?;
    let len = f.metadata().ok()?.len();
    let mut offset = 0u64;

    while offset + 8 <= len {
        f.seek(SeekFrom::Start(offset)).ok()?;
        let mut hdr = [0u8; 8];
        f.read_exact(&mut hdr).ok()?;
        let mut size = u32::from_be_bytes(hdr[0..4].try_into().ok()?) as u64;
        let typ = &hdr[4..8];

        let header_len = if size == 1 {
            let mut ext = [0u8; 8];
            f.read_exact(&mut ext).ok()?;
            size = u64::from_be_bytes(ext);
            16u64
        } else if size == 0 {
            size = len.saturating_sub(offset);
            8u64
        } else {
            8u64
        };
        if size < header_len {
            break;
        }

        if typ == b"moov" {
            return scan_moov(&mut f, offset + header_len, offset + size);
        }
        offset = offset.saturating_add(size);
    }
    None
}

fn scan_moov(f: &mut File, start: u64, end: u64) -> Option<f64> {
    let mut offset = start;
    while offset + 8 <= end {
        f.seek(SeekFrom::Start(offset)).ok()?;
        let mut hdr = [0u8; 8];
        f.read_exact(&mut hdr).ok()?;
        let mut size = u32::from_be_bytes(hdr[0..4].try_into().ok()?) as u64;
        let typ = &hdr[4..8];
        let header_len = if size == 1 {
            let mut ext = [0u8; 8];
            f.read_exact(&mut ext).ok()?;
            size = u64::from_be_bytes(ext);
            16u64
        } else if size == 0 {
            size = end.saturating_sub(offset);
            8u64
        } else {
            8u64
        };
        if size < header_len {
            break;
        }

        if typ == b"mvhd" {
            return read_mvhd(f, offset + header_len);
        }
        offset = offset.saturating_add(size);
    }
    None
}

fn read_mvhd(f: &mut File, start: u64) -> Option<f64> {
    f.seek(SeekFrom::Start(start)).ok()?;
    let mut ver = [0u8; 1];
    f.read_exact(&mut ver).ok()?;
    let version = ver[0];
    f.seek(SeekFrom::Current(3)).ok()?;

    let (timescale, duration) = if version == 1 {
        let mut buf = [0u8; 32];
        f.read_exact(&mut buf).ok()?;
        let timescale = u32::from_be_bytes(buf[16..20].try_into().ok()?);
        let duration = u64::from_be_bytes(buf[20..28].try_into().ok()?);
        (timescale, duration)
    } else {
        let mut buf = [0u8; 16];
        f.read_exact(&mut buf).ok()?;
        let timescale = u32::from_be_bytes(buf[8..12].try_into().ok()?);
        let duration = u32::from_be_bytes(buf[12..16].try_into().ok()?) as u64;
        (timescale, duration)
    };

    if timescale == 0 || duration == 0 {
        return None;
    }
    Some((duration as f64) * 1000.0 / (timescale as f64))
}

fn probe_mkv(path: &Path) -> Option<f64> {
    let mut f = File::open(path).ok()?;
    let file_len = f.metadata().ok()?.len();
    let take = (file_len as usize).min(2 * 1024 * 1024);
    let mut buf = vec![0u8; take];
    let n = f.read(&mut buf).ok()?;
    buf.truncate(n);

    let needle = [0x44u8, 0x89];
    let mut i = 0usize;
    while i + 2 < buf.len() {
        if buf[i] == needle[0] && buf[i + 1] == needle[1] {
            if let Some((size, size_len)) = read_ebml_size(&buf[i + 2..]) {
                let data_start = i + 2 + size_len;
                if size == 8 && data_start + 8 <= buf.len() {
                    let bits =
                        u64::from_be_bytes(buf[data_start..data_start + 8].try_into().ok()?);
                    let secs = f64::from_bits(bits);
                    if secs.is_finite() && secs > 0.0 && secs < 86400.0 * 100.0 {
                        return Some(secs * 1000.0);
                    }
                } else if size == 4 && data_start + 4 <= buf.len() {
                    let bits =
                        u32::from_be_bytes(buf[data_start..data_start + 4].try_into().ok()?);
                    let secs = f32::from_bits(bits) as f64;
                    if secs.is_finite() && secs > 0.0 {
                        return Some(secs * 1000.0);
                    }
                }
            }
        }
        i += 1;
    }
    None
}

fn read_ebml_size(data: &[u8]) -> Option<(usize, usize)> {
    if data.is_empty() {
        return None;
    }
    let first = data[0];
    let len = first.leading_zeros() as usize + 1;
    if len == 0 || len > 8 || data.len() < len {
        return None;
    }
    let mut value = (first & (0xFF >> len)) as usize;
    for b in &data[1..len] {
        value = (value << 8) | (*b as usize);
    }
    Some((value, len))
}

/// MP3 duration from Xing/Info frame count, else CBR estimate from bitrate × size.
fn probe_mp3(path: &Path) -> Option<f64> {
    let mut f = File::open(path).ok()?;
    let file_len = f.metadata().ok()?.len();
    if file_len < 4 {
        return None;
    }

    let mut hdr4 = [0u8; 10];
    let n = f.read(&mut hdr4).ok()?;
    let mut offset = 0u64;

    // Skip ID3v2
    if n >= 10 && &hdr4[0..3] == b"ID3" {
        let size = ((hdr4[6] as u64) << 21)
            | ((hdr4[7] as u64) << 14)
            | ((hdr4[8] as u64) << 7)
            | (hdr4[9] as u64);
        offset = 10 + size;
    }

    // Skip ID3v1 at end later for size calc
    let mut audio_end = file_len;
    if file_len >= 128 {
        let mut tag = [0u8; 3];
        f.seek(SeekFrom::Start(file_len - 128)).ok()?;
        if f.read_exact(&mut tag).is_ok() && &tag == b"TAG" {
            audio_end = file_len - 128;
        }
    }

    // Find first MPEG frame (scan a window)
    f.seek(SeekFrom::Start(offset)).ok()?;
    let window = ((audio_end - offset) as usize).min(64 * 1024);
    let mut buf = vec![0u8; window];
    let got = f.read(&mut buf).ok()?;
    buf.truncate(got);

    let mut i = 0usize;
    while i + 4 < buf.len() {
        if buf[i] == 0xFF && (buf[i + 1] & 0xE0) == 0xE0 {
            if let Some(info) = parse_mp3_frame_header(&buf[i..]) {
                // Look for Xing / Info after side info
                let side = mp3_side_info_size(info.version, info.channel_mode);
                let tag_at = i + 4 + side;
                if tag_at + 12 <= buf.len() {
                    let tag = &buf[tag_at..tag_at + 4];
                    if tag == b"Xing" || tag == b"Info" {
                        let flags = u32::from_be_bytes(buf[tag_at + 4..tag_at + 8].try_into().ok()?);
                        if flags & 0x1 != 0 && tag_at + 12 <= buf.len() {
                            let frames =
                                u32::from_be_bytes(buf[tag_at + 8..tag_at + 12].try_into().ok()?);
                            if frames > 0 && info.sample_rate > 0 {
                                let samples_per_frame = mp3_samples_per_frame(info.version, info.layer);
                                let secs = (frames as f64) * (samples_per_frame as f64)
                                    / (info.sample_rate as f64);
                                if secs > 0.0 {
                                    return Some(secs * 1000.0);
                                }
                            }
                        }
                    }
                }

                // CBR fallback from this frame's bitrate
                if info.bitrate_kbps > 0 {
                    let audio_bytes = audio_end.saturating_sub(offset + i as u64) as f64;
                    let secs = (audio_bytes * 8.0) / (info.bitrate_kbps as f64 * 1000.0);
                    if secs > 0.0 && secs < 86400.0 * 24.0 {
                        return Some(secs * 1000.0);
                    }
                }
            }
        }
        i += 1;
    }
    None
}

#[derive(Clone, Copy)]
struct Mp3FrameInfo {
    version: u8, // 0=2.5, 2=2, 3=1
    layer: u8,   // 1,2,3
    bitrate_kbps: u32,
    sample_rate: u32,
    channel_mode: u8,
}

fn parse_mp3_frame_header(data: &[u8]) -> Option<Mp3FrameInfo> {
    if data.len() < 4 {
        return None;
    }
    let b1 = data[1];
    let b2 = data[2];
    let b3 = data[3];

    let version_id = (b1 >> 3) & 0x03; // 0=2.5, 2=2, 3=1
    let layer_id = (b1 >> 1) & 0x03; // 1=III, 2=II, 3=I
    if version_id == 1 || layer_id == 0 {
        return None;
    }
    let bitrate_index = (b2 >> 4) & 0x0F;
    let sample_index = (b2 >> 2) & 0x03;
    if bitrate_index == 0 || bitrate_index == 15 || sample_index == 3 {
        return None;
    }
    let channel_mode = (b3 >> 6) & 0x03;

    let layer = match layer_id {
        1 => 3,
        2 => 2,
        3 => 1,
        _ => return None,
    };
    let version = version_id;

    let sample_rate = match (version, sample_index) {
        (3, 0) => 44100,
        (3, 1) => 48000,
        (3, 2) => 32000,
        (2, 0) => 22050,
        (2, 1) => 24000,
        (2, 2) => 16000,
        (0, 0) => 11025,
        (0, 1) => 12000,
        (0, 2) => 8000,
        _ => return None,
    };

    // Bitrate tables (kbps) for Layer III primarily; include Layer I/II roughly
    let bitrate_kbps = mp3_bitrate(version, layer, bitrate_index)?;

    Some(Mp3FrameInfo {
        version,
        layer,
        bitrate_kbps,
        sample_rate,
        channel_mode,
    })
}

fn mp3_bitrate(version: u8, layer: u8, index: u8) -> Option<u32> {
    // index 1..14
    let v1_l3: [u32; 15] = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
    let v1_l2: [u32; 15] = [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384];
    let v1_l1: [u32; 15] = [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448];
    let v2_l3: [u32; 15] = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
    let v2_l1: [u32; 15] = [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256];

    let idx = index as usize;
    if idx == 0 || idx >= 15 {
        return None;
    }
    let table = match (version, layer) {
        (3, 3) => &v1_l3,
        (3, 2) => &v1_l2,
        (3, 1) => &v1_l1,
        (2, 3) | (0, 3) => &v2_l3,
        (2, 2) | (0, 2) => &v2_l3, // reuse
        (2, 1) | (0, 1) => &v2_l1,
        _ => return None,
    };
    Some(table[idx])
}

fn mp3_samples_per_frame(version: u8, layer: u8) -> u32 {
    match (version, layer) {
        (_, 1) => 384,
        (3, 2) => 1152,
        (3, 3) => 1152,
        (_, 2) => 1152,
        (_, 3) => 576, // MPEG2/2.5 Layer III
        _ => 1152,
    }
}

fn mp3_side_info_size(version: u8, channel_mode: u8) -> usize {
    let mono = channel_mode == 3;
    match (version, mono) {
        (3, true) => 17,  // MPEG1 mono
        (3, false) => 32, // MPEG1 stereo
        (_, true) => 9,   // MPEG2 mono
        (_, false) => 17,
    }
}

fn probe_wav(path: &Path) -> Option<f64> {
    let mut f = File::open(path).ok()?;
    let mut hdr = [0u8; 44];
    f.read_exact(&mut hdr).ok()?;
    if &hdr[0..4] != b"RIFF" || &hdr[8..12] != b"WAVE" {
        return None;
    }
    // Find fmt + data chunks
    f.seek(SeekFrom::Start(12)).ok()?;
    let file_len = f.metadata().ok()?.len();
    let mut pos = 12u64;
    let mut byte_rate = 0u32;
    let mut data_size = 0u32;
    while pos + 8 <= file_len {
        let mut chunk = [0u8; 8];
        f.seek(SeekFrom::Start(pos)).ok()?;
        f.read_exact(&mut chunk).ok()?;
        let id = &chunk[0..4];
        let size = u32::from_le_bytes(chunk[4..8].try_into().ok()?);
        if id == b"fmt " && size >= 16 {
            let mut fmt = [0u8; 16];
            f.read_exact(&mut fmt).ok()?;
            byte_rate = u32::from_le_bytes(fmt[8..12].try_into().ok()?);
        } else if id == b"data" {
            data_size = size;
            break;
        }
        pos = pos + 8 + size as u64 + (size as u64 % 2); // word align
    }
    if byte_rate == 0 || data_size == 0 {
        return None;
    }
    Some((data_size as f64) * 1000.0 / (byte_rate as f64))
}

fn probe_flac(path: &Path) -> Option<f64> {
    let mut f = File::open(path).ok()?;
    let mut magic = [0u8; 4];
    f.read_exact(&mut magic).ok()?;
    if &magic != b"fLaC" {
        return None;
    }
    // STREAMINFO is first metadata block
    let mut block_hdr = [0u8; 4];
    f.read_exact(&mut block_hdr).ok()?;
    let block_type = block_hdr[0] & 0x7F;
    let size = ((block_hdr[1] as u32) << 16) | ((block_hdr[2] as u32) << 8) | block_hdr[3] as u32;
    if block_type != 0 || size < 18 {
        return None;
    }
    let mut info = vec![0u8; size as usize];
    f.read_exact(&mut info).ok()?;
    // sample rate: bits 80-99 (20 bits) starting at byte 10
    // total samples: bits 100-135 (36 bits)
    let sr = ((info[10] as u32) << 12) | ((info[11] as u32) << 4) | ((info[12] as u32) >> 4);
    let total_samples = (((info[13] as u64) & 0x0F) << 32)
        | ((info[14] as u64) << 24)
        | ((info[15] as u64) << 16)
        | ((info[16] as u64) << 8)
        | (info[17] as u64);
    if sr == 0 || total_samples == 0 {
        return None;
    }
    Some((total_samples as f64) * 1000.0 / (sr as f64))
}
