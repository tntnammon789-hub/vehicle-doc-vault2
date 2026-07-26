import React, { useState, useEffect, useCallback, useMemo } from 'react'
import Dexie from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { QRCodeSVG } from 'qrcode.react'

// ============================================================
// 0. ERROR BOUNDARY (ป้องกันหน้าจอขาวแบบ 100%)
// ============================================================
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error("Uncaught error:", error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f8f9fa',
          padding: '20px',
          fontFamily: 'sans-serif'
        }}>
          <div style={{
            background: 'white',
            padding: '24px',
            borderRadius: '16px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
            textAlign: 'center',
            maxWidth: '400px'
          }}>
            <h2 style={{ color: '#c62828', marginTop: 0 }}>⚠️ เกิดข้อผิดพลาดในระบบ</h2>
            <p style={{ color: '#666', fontSize: '14px' }}>
              {this.state.error?.toString() || 'ข้อมูลในลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว'}
            </p>
            <button
              onClick={() => window.location.href = window.location.origin}
              style={{
                background: '#1a237e',
                color: 'white',
                border: 'none',
                padding: '10px 20px',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              กลับสู่หน้าหลัก
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

// ============================================================
// 1. DATABASE
// ============================================================
const db = new Dexie('VehicleDocsDB_v2')

db.version(1).stores({
  documents: '++id, category, categoryKey, plateNumber, fileName, expiryDate, createdAt',
  shares: '++id, docId, token, maxViews, currentViews, expiresAt, password, createdAt, isActive'
})

// ============================================================
// 2. CONSTANTS
// ============================================================
const CATEGORIES = [
  { key: 'all', label: '📋 ทั้งหมด', color: '#3949ab' },
  { key: 'license', label: '🪪 ใบขับขี่', color: '#1a237e' },
  { key: 'regis', label: '📄 ทะเบียนรถ', color: '#2e7d32' },
  { key: 'insurance', label: '🛡️ พรบ./ประกัน', color: '#e65100' },
  { key: 'tax', label: '🏷️ ป้ายภาษี', color: '#6a1b9a' },
]

const SHARE_DURATIONS = [
  { value: 5, label: '5 นาที' },
  { value: 15, label: '15 นาที' },
  { value: 30, label: '30 นาที' },
  { value: 60, label: '1 ชั่วโมง' },
  { value: 1440, label: '24 ชั่วโมง' },
]

// ============================================================
// 3. UTILITIES & DIRECT IMAGE UPLOAD
// ============================================================
const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
  })
}

const generateToken = () => {
  if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }
  return Math.random().toString(36).substring(2) + Date.now().toString(36)
}

const getDaysUntil = (dateStr) => {
  if (!dateStr || dateStr === 'ไม่ระบุ') return null
  const diff = new Date(dateStr) - new Date()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

const formatThaiDate = (iso) => {
  if (!iso || iso === 'ไม่ระบุ') return 'ไม่ระบุ'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })
}

// อัปโหลดฝากรูปที่ Imgur Direct Link (แสดงผลรูปภาพได้ทันที 100%)
const uploadToTempStorage = async (base64Str) => {
  try {
    const cleanBase64 = base64Str.replace(/^data:image\/(png|jpg|jpeg);base64,/, '')
    const formData = new FormData()
    formData.append('image', cleanBase64)
    formData.append('type', 'base64')

    const response = await fetch('https://api.imgur.com/3/image', {
      method: 'POST',
      headers: {
        Authorization: 'Client-ID c982463f03b0c26',
      },
      body: formData,
    })

    const result = await response.json()
    if (result && result.success && result.data?.link) {
      return result.data.link
    }
    return null
  } catch (err) {
    console.error('Upload Error:', err)
    return null
  }
}

// เข้ารหัสข้อมูลอย่างปลอดภัย
const safeEncodeData = (obj) => {
  try {
    const str = JSON.stringify(obj)
    return encodeURIComponent(btoa(encodeURIComponent(str)))
  } catch (err) {
    console.error('Encoding error:', err)
    return ''
  }
}

const safeDecodeData = (encodedStr) => {
  try {
    if (!encodedStr) return null
    const decodedStr = decodeURIComponent(atob(decodeURIComponent(encodedStr)))
    return JSON.parse(decodedStr)
  } catch (err) {
    console.error('Decoding error:', err)
    return null
  }
}

// ============================================================
// 4. TOAST
// ============================================================
function Toast({ message, visible, onClose }) {
  useEffect(() => {
    if (!visible) return
    const t = setTimeout(onClose, 3000)
    return () => clearTimeout(t)
  }, [visible, onClose])

  if (!visible) return null
  return (
    <div
      style={{
        position: 'fixed',
        bottom: '100px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: '#1a1a2e',
        color: 'white',
        padding: '14px 28px',
        borderRadius: '50px',
        fontSize: '14px',
        zIndex: 1000,
        boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
        fontWeight: 500,
        maxWidth: '90vw',
        textAlign: 'center',
      }}
    >
      {message}
    </div>
  )
}

// ============================================================
// 5. SHARE MODAL
// ============================================================
function ShareModal({ doc, onClose, onShareCreated }) {
  const [duration, setDuration] = useState(15)
  const [maxViews, setMaxViews] = useState(3)
  const [requirePassword, setRequirePassword] = useState(false)
  const [password, setPassword] = useState('')
  const [shareUrl, setShareUrl] = useState('')
  const [countdown, setCountdown] = useState('')
  const [isSharing, setIsSharing] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!isSharing || !shareUrl) return
    let token = ''
    try {
      const urlObj = new URL(shareUrl)
      token = urlObj.searchParams.get('share') || urlObj.pathname.split('/').pop()
    } catch {
      token = shareUrl.split('=').pop() || shareUrl.split('/').pop()
    }

    const interval = setInterval(async () => {
      try {
        const rec = await db.shares.where('token').equals(token).first()
        if (!rec || !rec.isActive) {
          setCountdown('หมดเวลา')
          clearInterval(interval)
          return
        }
        const remaining = Math.max(0, new Date(rec.expiresAt) - Date.now())
        const m = Math.floor(remaining / 60000)
        const s = Math.floor((remaining % 60000) / 1000)
        setCountdown(`${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`)
      } catch {
        setCountdown('หมดเวลา')
        clearInterval(interval)
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [isSharing, shareUrl])

  const handleStartShare = async () => {
    setIsUploading(true)
    try {
      const token = generateToken()
      const expiresAt = new Date(Date.now() + duration * 60 * 1000)

      // ฝากไฟล์รูปภาพตรงที่เซิร์ฟเวอร์ที่รองรับ Direct Link
      const remoteImgUrl = await uploadToTempStorage(doc.imageData)

      await db.shares.add({
        docId: doc.id,
        token,
        maxViews: parseInt(maxViews, 10),
        currentViews: 0,
        expiresAt,
        password: requirePassword && password ? password : null,
        createdAt: new Date(),
        isActive: true,
      })

      // ส่ง Direct Image URL ไปแสดงผลรูปโดยตรง
      const sharePayload = {
        c: doc.category,
        p: doc.plateNumber,
        e: doc.expiryDate,
        imgUrl: remoteImgUrl,
        exp: expiresAt.getTime(),
        pwd: requirePassword && password ? password : null,
      }

      const encodedData = safeEncodeData(sharePayload)
      const baseUrl = typeof window !== 'undefined' ? window.location.origin + window.location.pathname : ''
      
      const url = `${baseUrl}?share=${token}&data=${encodedData}`
      setShareUrl(url)
      setIsSharing(true)
      setCountdown(`${String(duration).padStart(2, '0')}:00`)
      onShareCreated?.()
    } catch (err) {
      console.error(err)
      alert('เกิดข้อผิดพลาดในการสร้างลิงก์แชร์')
    } finally {
      setIsUploading(false)
    }
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = shareUrl
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div style={overlayStyle} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={sheetStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ margin: 0, color: '#1a237e', fontSize: '18px', fontWeight: 700 }}>
            {'📡 แชร์เอกสาร'}
          </h3>
          <button onClick={onClose} style={closeBtnStyle}>
            {'✕'}
          </button>
        </div>

        <div style={{ textAlign: 'center', marginBottom: '16px' }}>
          <div
            style={{
              display: 'inline-block',
              padding: '16px',
              background: 'white',
              borderRadius: '16px',
              border: '3px solid #1a237e',
              boxShadow: '0 4px 16px rgba(26,35,126,0.15)',
              maxWidth: '100%',
              boxSizing: 'border-box',
            }}
          >
            {isSharing && shareUrl ? (
              <QRCodeSVG
                value={shareUrl}
                size={180}
                level="L"
                includeMargin={true}
                bgColor="#ffffff"
                fgColor="#1a237e"
                style={{ width: '100%', height: 'auto', maxWidth: '180px' }}
              />
            ) : (
              <div
                style={{
                  width: '180px',
                  height: '180px',
                  maxWidth: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#999',
                  fontSize: '13px',
                }}
              >
                {isUploading ? '⌛ กำลังอัปโหลดฝากรูป...' : 'กด "เริ่มแชร์" เพื่อสร้าง QR'}
              </div>
            )}
          </div>
          <h4 style={{ color: '#1a237e', margin: '12px 0 4px', fontSize: '16px' }}>
            {doc.category} — {doc.plateNumber}
          </h4>
          <p style={{ fontSize: '12px', color: '#888', margin: 0 }}>
            {isSharing ? 'สแกน QR หรือเปิดลิงก์เพื่อดูเอกสาร' : 'ตั้งค่าการแชร์ด้านล่าง'}
          </p>
        </div>

        {!isSharing ? (
          <div style={settingsPanelStyle}>
            <h5 style={{ margin: '0 0 14px', fontSize: '14px', color: '#333', fontWeight: 600 }}>
              {'⚙️ ตั้งค่าการแชร์'}
            </h5>

            <div style={settingRowStyle}>
              <label style={settingLabelStyle}>{'⏱️ จำกัดเวลา'}</label>
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                style={settingSelectStyle}
              >
                {SHARE_DURATIONS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>

            <div style={settingRowStyle}>
              <label style={settingLabelStyle}>{'👁️ จำกัดจำนวนดู (ครั้ง)'}</label>
              <input
                type="number"
                min={1}
                max={50}
                value={maxViews}
                onChange={(e) => setMaxViews(Math.max(1, Math.min(50, Number(e.target.value))))}
                style={{ ...settingSelectStyle, width: '70px' }}
              />
            </div>

            <div style={settingRowStyle}>
              <label style={settingLabelStyle}>{'🔒 ตั้งรหัสผ่าน'}</label>
              <input
                type="checkbox"
                checked={requirePassword}
                onChange={(e) => setRequirePassword(e.target.checked)}
                style={{ width: '20px', height: '20px', cursor: 'pointer' }}
              />
            </div>

            {requirePassword && (
              <div style={{ marginTop: '8px' }}>
                <input
                  type="password"
                  placeholder="ตั้งรหัสผ่าน"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: '10px',
                    border: '2px solid #e0e0e0',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            )}

            <button
              onClick={handleStartShare}
              disabled={isUploading}
              style={{ ...btnPrimaryStyle, marginTop: '16px', opacity: isUploading ? 0.7 : 1 }}
            >
              {isUploading ? '⌛ กำลังเตรียมข้อมูล...' : '🚀 เริ่มแชร์'}
            </button>
          </div>
        ) : (
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                fontSize: '36px',
                fontWeight: 700,
                color: '#e53935',
                fontFamily: 'monospace',
                letterSpacing: '2px',
                margin: '8px 0',
              }}
            >
              {countdown}
            </div>
            <p style={{ fontSize: '12px', color: '#888', margin: '0 0 12px' }}>เหลือเวลาแชร์</p>

            <div
              onClick={copyLink}
              style={{
                background: '#e8eaf6',
                borderRadius: '12px',
                padding: '14px',
                fontSize: '12px',
                color: '#3949ab',
                wordBreak: 'break-all',
                marginTop: '12px',
                fontFamily: 'monospace',
                cursor: 'pointer',
                border: '2px dashed #c5cae9',
                transition: 'all 0.2s',
              }}
            >
              {shareUrl}
              <div style={{ fontSize: '11px', color: '#666', marginTop: '6px', fontFamily: 'inherit' }}>
                {copied ? '✅ คัดลอกแล้ว!' : '👆 คลิกเพื่อคัดลอก'}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
              <button onClick={onClose} style={{ ...btnSecondaryStyle, flex: 1 }}>
                ปิด
              </button>
              <button onClick={copyLink} style={{ ...btnPrimaryStyle, flex: 1 }}>
                {copied ? '✅ คัดลอกแล้ว' : '📋 คัดลอกลิงก์'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================
// 6. ADD MODAL
// ============================================================
function AddModal({ initialCategory = 'license', onClose, onAdded }) {
  const [category, setCategory] = useState(initialCategory !== 'all' ? initialCategory : 'license')
  const [plateNumber, setPlateNumber] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [previewUrl, setPreviewUrl] = useState(null)
  const [base64Image, setBase64Image] = useState(null)
  const [fileName, setFileName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleFileChange = (e) => {
    const file = e.target.files[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      alert('ไฟล์ต้องไม่เกิน 5MB')
      return
    }
    setFileName(file.name)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    const objUrl = URL.createObjectURL(file)
    setPreviewUrl(objUrl)

    fileToBase64(file)
      .then((b64) => setBase64Image(b64))
      .catch(() => alert('อ่านไฟล์ไม่สำเร็จ'))
  }

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!base64Image) {
      alert('กรุณาเลือกรูปภาพ')
      return
    }
    setIsSubmitting(true)
    try {
      const catObj = CATEGORIES.find((c) => c.key === category)
      await db.documents.add({
        category: catObj.label,
        categoryKey: category,
        plateNumber: plateNumber.trim() || 'ไม่ระบุ',
        expiryDate: expiryDate || 'ไม่ระบุ',
        fileName: fileName,
        imageData: base64Image,
        fileSize: 0,
        createdAt: new Date().toISOString(),
      })
      onAdded?.()
      onClose()
    } catch (err) {
      console.error(err)
      alert('เกิดข้อผิดพลาด: ' + err.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div style={overlayStyle} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={sheetStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ margin: 0, color: '#1a237e', fontSize: '18px', fontWeight: 700 }}>
            {'➕ เพิ่มเอกสารใหม่'}
          </h3>
          <button onClick={onClose} style={closeBtnStyle}>
            {'✕'}
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={formGroupStyle}>
            <label style={labelStyle}>หมวดหมู่เอกสาร</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle}>
              {CATEGORIES.filter((c) => c.key !== 'all').map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div style={formGroupStyle}>
            <label style={labelStyle}>ทะเบียนรถ / หมายเลข</label>
            <input
              type="text"
              placeholder="เช่น กข 1234 กทม."
              value={plateNumber}
              onChange={(e) => setPlateNumber(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div style={formGroupStyle}>
            <label style={labelStyle}>วันหมดอายุ</label>
            <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} style={inputStyle} />
          </div>

          <div style={formGroupStyle}>
            <label style={labelStyle}>แนบรูปภาพ (สูงสุด 5MB)</label>
            <div
              onClick={() => document.getElementById('fileInput')?.click()}
              style={uploadAreaStyle}
            >
              <div style={{ fontSize: '40px', marginBottom: '6px' }}>{'📷'}</div>
              <p style={{ margin: 0, fontSize: '13px', color: '#666' }}>แตะเพื่อเลือกรูปภาพ</p>
              <small style={{ color: '#999' }}>รองรับ JPG, PNG</small>
            </div>
            <input id="fileInput" type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />
            {previewUrl && (
              <img
                src={previewUrl}
                alt="preview"
                style={{
                  width: '100%',
                  maxHeight: '30vh',
                  objectFit: 'contain',
                  borderRadius: '12px',
                  marginTop: '12px',
                  border: '2px solid #e0e0e0',
                  background: '#000',
                }}
              />
            )}
          </div>

          <button type="submit" disabled={isSubmitting} style={{ ...btnPrimaryStyle, opacity: isSubmitting ? 0.7 : 1 }}>
            {isSubmitting ? '⌛ กำลังบันทึก...' : '💾 บันทึกลงเครื่อง'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ============================================================
// 7. DOCUMENT CARD
// ============================================================
function DocCard({ doc, onShare, onDelete }) {
  const daysLeft = getDaysUntil(doc.expiryDate)
  const isExpiringSoon = daysLeft !== null && daysLeft < 30 && daysLeft >= 0
  const isExpired = daysLeft !== null && daysLeft < 0

  const expiryText = isExpired
    ? 'หมดอายุแล้ว'
    : daysLeft === null
    ? 'ไม่ระบุวันหมดอายุ'
    : isExpiringSoon
    ? `เหลือ ${daysLeft} วัน`
    : `หมดอายุ ${formatThaiDate(doc.expiryDate)}`

  return (
    <div style={cardStyle}>
      <img
        src={doc.imageData || 'https://placehold.co/70x70/ccc/666?text=NO+IMG'}
        alt="doc"
        style={{
          width: '72px',
          height: '72px',
          objectFit: 'cover',
          borderRadius: '12px',
          border: '2px solid #e8eaf6',
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <h4
          style={{
            margin: '0 0 4px',
            color: '#1a237e',
            fontSize: '15px',
            fontWeight: 700,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {doc.category}
        </h4>
        <p style={{ margin: '0 0 4px', fontSize: '13px', color: '#555' }}>{'🚗'} {doc.plateNumber}</p>
        <span
          style={{
            fontSize: '11px',
            padding: '3px 10px',
            borderRadius: '20px',
            display: 'inline-block',
            fontWeight: 600,
            background: isExpired ? '#eceff1' : isExpiringSoon ? '#ffebee' : '#e8f5e9',
            color: isExpired ? '#78909c' : isExpiringSoon ? '#c62828' : '#2e7d32',
          }}
        >
          {isExpired ? '⚠️ ' : isExpiringSoon ? '⏰ ' : '✅ '}
          {expiryText}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <button onClick={() => onShare(doc)} style={iconBtnStyle('#e3f2fd', '#1976d2')} title="แชร์">
          {'📡'}
        </button>
        <button onClick={() => onDelete(doc.id)} style={iconBtnStyle('#ffebee', '#c62828')} title="ลบ">
          {'🗑️'}
        </button>
      </div>
    </div>
  )
}

// ============================================================
// 8. SHARE VIEWER PAGE (แสดงรูปภาพหน้าเว็บโดยตรงทันที)
// ============================================================
function ShareViewer({ token, encodedData }) {
  const [status, setStatus] = useState('loading')
  const [doc, setDoc] = useState(null)
  const [inputPassword, setInputPassword] = useState('')
  const [error, setError] = useState('')
  const [viewCount, setViewCount] = useState(1)

  useEffect(() => {
    let cancelled = false

    const validate = async () => {
      try {
        if (token) {
          const share = await db.shares.where('token').equals(token).first()
          if (share && share.isActive) {
            if (new Date(share.expiresAt) < new Date()) {
              await db.shares.update(share.id, { isActive: false })
              if (!cancelled) setStatus('expired')
              return
            }
            if (share.currentViews >= share.maxViews) {
              if (!cancelled) setStatus('limit')
              return
            }
            if (share.password) {
              if (!cancelled) {
                setDoc(share)
                setStatus('password')
              }
              return
            }
            await openDocument(share)
            return
          }
        }

        if (encodedData) {
          const payload = safeDecodeData(encodedData)

          if (!payload) {
            if (!cancelled) setStatus('expired')
            return
          }

          if (payload.exp && Date.now() > payload.exp) {
            if (!cancelled) setStatus('expired')
            return
          }

          const documentObj = {
            category: payload.c,
            plateNumber: payload.p,
            expiryDate: payload.e,
            imageData: payload.imgUrl || null,
            password: payload.pwd,
          }

          if (payload.pwd) {
            if (!cancelled) {
              setDoc(documentObj)
              setStatus('password')
            }
            return
          }

          if (!cancelled) {
            setDoc(documentObj)
            setViewCount(1)
            setStatus('viewing')
          }
          return
        }

        if (!cancelled) setStatus('expired')
      } catch (err) {
        console.error(err)
        if (!cancelled) setStatus('expired')
      }
    }

    const openDocument = async (share) => {
      try {
        const document = await db.documents.get(share.docId)
        if (!document) {
          if (!cancelled) setStatus('expired')
          return
        }
        const newCount = share.currentViews + 1
        await db.shares.update(share.id, {
          currentViews: newCount,
          isActive: newCount < share.maxViews,
        })
        if (!cancelled) {
          setDoc(document)
          setViewCount(newCount)
          setStatus('viewing')
        }
      } catch (err) {
        console.error(err)
        if (!cancelled) setStatus('expired')
      }
    }

    validate()
    return () => {
      cancelled = true
    }
  }, [token, encodedData])

  const checkPassword = async () => {
    try {
      if (doc && doc.password) {
        if (doc.password === inputPassword) {
          setStatus('viewing')
        } else {
          setError('รหัสผ่านไม่ถูกต้อง')
        }
        return
      }

      if (token) {
        const share = await db.shares.where('token').equals(token).first()
        if (!share) {
          setStatus('expired')
          return
        }
        if (share.password === inputPassword) {
          const document = await db.documents.get(share.docId)
          if (!document) {
            setStatus('expired')
            return
          }
          const newCount = share.currentViews + 1
          await db.shares.update(share.id, {
            currentViews: newCount,
            isActive: newCount < share.maxViews,
          })
          setDoc(document)
          setViewCount(newCount)
          setStatus('viewing')
        } else {
          setError('รหัสผ่านไม่ถูกต้อง')
        }
      }
    } catch (err) {
      console.error(err)
      setStatus('expired')
    }
  }

  if (status === 'loading') {
    return (
      <div style={viewerContainerStyle}>
        <div style={viewerBoxStyle}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>{'⌛'}</div>
          <h2 style={{ color: '#1a237e', margin: '0 0 8px', fontSize: '20px' }}>กำลังตรวจสอบ...</h2>
        </div>
      </div>
    )
  }

  if (status === 'expired') {
    return (
      <div style={viewerContainerStyle}>
        <div style={viewerBoxStyle}>
          <div style={{ fontSize: '60px', marginBottom: '12px' }}>{'🔒'}</div>
          <h2 style={{ color: '#c62828', margin: '0 0 8px', fontSize: '20px' }}>ลิงก์หมดอายุแล้ว</h2>
          <p style={{ color: '#666', fontSize: '14px' }}>ลิงก์นี้หมดเวลาหรือถูกปิดการใช้งานแล้ว</p>
        </div>
      </div>
    )
  }

  if (status === 'limit') {
    return (
      <div style={viewerContainerStyle}>
        <div style={viewerBoxStyle}>
          <div style={{ fontSize: '60px', marginBottom: '12px' }}>{'🚷'}</div>
          <h2 style={{ color: '#e65100', margin: '0 0 8px', fontSize: '20px' }}>จำนวนครั้งเต็มแล้ว</h2>
          <p style={{ color: '#666', fontSize: '14px' }}>เอกสารนี้ถูกดูครบตามจำนวนที่กำหนดแล้ว</p>
        </div>
      </div>
    )
  }

  if (status === 'password') {
    return (
      <div style={viewerContainerStyle}>
        <div style={viewerBoxStyle}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>{'🔐'}</div>
          <h2 style={{ color: '#1a237e', margin: '0 0 16px', fontSize: '20px' }}>เอกสารถูกล็อก</h2>
          <p style={{ color: '#666', fontSize: '13px', marginBottom: '16px' }}>กรุณากรอกรหัสผ่านเพื่อดูเอกสาร</p>
          <input
            type="password"
            placeholder="รหัสผ่าน"
            value={inputPassword}
            onChange={(e) => setInputPassword(e.target.value)}
            style={{
              width: '100%',
              padding: '12px 14px',
              borderRadius: '12px',
              border: '2px solid #e0e0e0',
              fontSize: '15px',
              marginBottom: '12px',
              textAlign: 'center',
              boxSizing: 'border-box',
              outline: 'none',
            }}
            onKeyDown={(e) => e.key === 'Enter' && checkPassword()}
          />
          {error && <p style={{ color: '#c62828', fontSize: '13px', margin: '0 0 12px' }}>{error}</p>}
          <button onClick={checkPassword} style={btnPrimaryStyle}>
            {'🔓 ปลดล็อก'}
          </button>
        </div>
      </div>
    )
  }

  if (status === 'viewing' && doc) {
    return (
      <div style={viewerContainerStyle}>
        <div style={{ ...viewerBoxStyle, maxWidth: '600px', width: '100%', padding: '24px', boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 style={{ margin: 0, color: '#1a237e', fontSize: '18px' }}>{doc.category}</h2>
            <span
              style={{
                fontSize: '11px',
                color: '#888',
                background: '#f5f5f5',
                padding: '4px 10px',
                borderRadius: '10px',
              }}
            >
              ดูครั้งที่ {viewCount}
            </span>
          </div>

          {doc.imageData ? (
            <div style={{ width: '100%', maxHeight: '65vh', display: 'flex', justifyContent: 'center', alignItems: 'center', overflow: 'hidden', borderRadius: '12px', border: '1px solid #e0e0e0', marginBottom: '16px', background: '#000' }}>
              <img
                src={doc.imageData}
                alt="เอกสารยานพาหนะ"
                style={{
                  maxWidth: '100%',
                  maxHeight: '65vh',
                  objectFit: 'contain',
                  width: 'auto',
                  height: 'auto',
                  display: 'block'
                }}
              />
            </div>
          ) : (
            <div style={{ padding: '24px 16px', background: '#fff3e0', borderRadius: '12px', marginBottom: '16px', color: '#e65100', border: '1px solid #ffe0b2' }}>
              <div style={{ fontSize: '32px', marginBottom: '8px' }}>📄</div>
              <p style={{ margin: 0, fontWeight: 600, fontSize: '14px' }}>ไม่พบไฟล์รูปภาพเอกสาร</p>
            </div>
          )}

          <div style={{ display: 'grid', gap: '8px', fontSize: '14px', color: '#555', textAlign: 'left' }}>
            <p style={{ margin: 0 }}>
              <b>ทะเบียน:</b> {doc.plateNumber}
            </p>
            <p style={{ margin: 0 }}>
              <b>หมดอายุ:</b> {formatThaiDate(doc.expiryDate)}
            </p>
          </div>
          <p style={{ fontSize: '11px', color: '#999', textAlign: 'center', marginTop: '20px' }}>
            {'🔒 เอกสารนี้แชร์ผ่าน Vehicle Doc Vault'}
          </p>
        </div>
      </div>
    )
  }

  return null
}

// ============================================================
// 9. MAIN APP WITH ERROR BOUNDARY
// ============================================================
export default function App() {
  const [urlInfo, setUrlInfo] = useState(() => {
    if (typeof window === 'undefined') return { pathname: '/', search: '' }
    return { pathname: window.location.pathname, search: window.location.search }
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onPop = () => setUrlInfo({ pathname: window.location.pathname, search: window.location.search })
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const searchParams = new URLSearchParams(urlInfo.search)
  const shareToken = searchParams.get('share') || (urlInfo.pathname ? urlInfo.pathname.match(/^\/share\/(.+)$/)?.[1] : null)
  const encodedData = searchParams.get('data')

  const [activeCategory, setActiveCategory] = useState('all')
  const [showAddModal, setShowAddModal] = useState(false)
  const [shareDoc, setShareDoc] = useState(null)
  const [toast, setToast] = useState({ message: '', visible: false })

  const allDocs = useLiveQuery(() => db.documents.toArray(), []) || []

  const activeSharesCount = useLiveQuery(() => {
    const now = new Date()
    return db.shares
      .filter((s) => s.isActive === true && new Date(s.expiresAt) > now)
      .count()
  }, []) || 0

  const filteredDocs = useMemo(() => {
    if (activeCategory === 'all') return allDocs
    const catLabel = CATEGORIES.find((c) => c.key === activeCategory)?.label
    return allDocs.filter((d) => d.category === catLabel || d.categoryKey === activeCategory)
  }, [allDocs, activeCategory])

  const stats = useMemo(() => {
    const expiringSoon = allDocs.filter((d) => {
      const days = getDaysUntil(d.expiryDate)
      return days !== null && days < 30 && days >= 0
    }).length
    return {
      total: allDocs.length,
      expiringSoon,
      activeShares: activeSharesCount,
    }
  }, [allDocs, activeSharesCount])

  const showToast = useCallback((message) => {
    setToast({ message, visible: true })
  }, [])

  const handleDelete = async (id) => {
    if (!confirm('คุณต้องการลบเอกสารนี้ใช่หรือไม่?')) return
    try {
      await db.documents.delete(id)
      await db.shares.where('docId').equals(id).delete()
      showToast('🗑️ ลบเอกสารแล้ว')
    } catch (err) {
      console.error(err)
    }
  }

  const handleCategoryClick = (key) => {
    if (key === activeCategory && key !== 'all') {
      setShowAddModal(true)
    } else {
      setActiveCategory(key)
      if (key !== 'all') {
        setShowAddModal(true)
      }
    }
  }

  return (
    <ErrorBoundary>
      {(shareToken || encodedData) ? (
        <ShareViewer token={shareToken} encodedData={encodedData} />
      ) : (
        <div style={appContainerStyle}>
          <div style={headerStyle}>
            <h1 style={{ fontSize: '22px', fontWeight: 700, margin: 0 }}>
              {'🔐 Vehicle Doc Vault'}
            </h1>
            <p style={{ fontSize: '13px', opacity: 0.85, marginTop: '4px' }}>
              จัดเก็บเอกสารยานพาหนะของคุณอย่างปลอดภัย 100% Client-side
            </p>
            <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
              <div style={statCardStyle}>
                <div style={{ fontSize: '22px', fontWeight: 700 }}>{stats.total}</div>
                <div style={{ fontSize: '11px', opacity: 0.85 }}>เอกสารทั้งหมด</div>
              </div>
              <div style={statCardStyle}>
                <div style={{ fontSize: '22px', fontWeight: 700, color: stats.expiringSoon > 0 ? '#ffeb3b' : 'white' }}>
                  {stats.expiringSoon}
                </div>
                <div style={{ fontSize: '11px', opacity: 0.85 }}>ใกล้หมดอายุ</div>
              </div>
              <div style={statCardStyle}>
                <div style={{ fontSize: '22px', fontWeight: 700 }}>{stats.activeShares}</div>
                <div style={{ fontSize: '11px', opacity: 0.85 }}>กำลังแชร์</div>
              </div>
            </div>
          </div>

          <div style={{ padding: '20px', paddingBottom: '100px' }}>
            <div
              className="no-scrollbar"
              style={{
                display: 'flex',
                gap: '10px',
                overflowX: 'auto',
                paddingBottom: '10px',
                marginBottom: '16px',
                WebkitOverflowScrolling: 'touch',
                scrollSnapType: 'x mandatory',
              }}
            >
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.key}
                  onClick={() => handleCategoryClick(cat.key)}
                  style={{
                    flexShrink: 0,
                    padding: '10px 18px',
                    borderRadius: '24px',
                    border: 'none',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.3s',
                    background: activeCategory === cat.key ? cat.color : 'white',
                    color: activeCategory === cat.key ? 'white' : '#666',
                    boxShadow:
                      activeCategory === cat.key
                        ? `0 4px 12px ${cat.color}50`
                        : '0 2px 8px rgba(0,0,0,0.06)',
                    scrollSnapAlign: 'start',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {filteredDocs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '50px 20px', color: '#999' }}>
                <div style={{ fontSize: '64px', marginBottom: '12px', opacity: 0.4 }}>{'📬'}</div>
                <p style={{ fontSize: '15px', margin: 0 }}>ยังไม่มีเอกสารในหมวดหมู่นี้</p>
                <small style={{ fontSize: '12px', color: '#bbb', marginTop: '6px', display: 'block' }}>
                  แตะหมวดหมู่ หรือกดปุ่ม + เพื่อเพิ่มเอกสาร
                </small>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '12px' }}>
                {filteredDocs.map((doc) => (
                  <DocCard key={doc.id} doc={doc} onShare={setShareDoc} onDelete={handleDelete} />
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => setShowAddModal(true)}
            style={fabStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.1)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)'
            }}
          >
            +
          </button>

          {showAddModal && (
            <AddModal
              initialCategory={activeCategory}
              onClose={() => setShowAddModal(false)}
              onAdded={() => showToast('✅ บันทึกเอกสารสำเร็จ')}
            />
          )}

          {shareDoc && (
            <ShareModal
              doc={shareDoc}
              onClose={() => setShareDoc(null)}
              onShareCreated={() => showToast('🔗 สร้างลิงก์แชร์สำเร็จ')}
            />
          )}

          <Toast
            message={toast.message}
            visible={toast.visible}
            onClose={() => setToast({ ...toast, visible: false })}
          />

          <style>{`
            .no-scrollbar::-webkit-scrollbar {
              display: none;
            }
            .no-scrollbar {
              -ms-overflow-style: none;
              scrollbar-width: none;
            }
          `}</style>
        </div>
      )}
    </ErrorBoundary>
  )
}

// ============================================================
// 10. STYLES
// ============================================================
const appContainerStyle = {
  maxWidth: '480px',
  margin: '0 auto',
  minHeight: '100vh',
  background: '#f5f7fa',
  fontFamily: "'Sarabun', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  position: 'relative',
  overflow: 'hidden',
  width: '100%',
  boxSizing: 'border-box',
}

const headerStyle = {
  background: 'linear-gradient(135deg, #1a237e 0%, #3949ab 100%)',
  color: 'white',
  padding: '24px 20px 36px',
  borderRadius: '0 0 30px 30px',
  boxShadow: '0 4px 24px rgba(26,35,126,0.35)',
}

const statCardStyle = {
  flex: 1,
  background: 'rgba(255,255,255,0.15)',
  backdropFilter: 'blur(10px)',
  borderRadius: '14px',
  padding: '14px 8px',
  textAlign: 'center',
  border: '1px solid rgba(255,255,255,0.1)',
}

const fabStyle = {
  position: 'fixed',
  bottom: '24px',
  right: '24px',
  width: '60px',
  height: '60px',
  borderRadius: '50%',
  background: 'linear-gradient(135deg, #ff6b6b, #ee5a24)',
  color: 'white',
  border: 'none',
  fontSize: '32px',
  cursor: 'pointer',
  boxShadow: '0 6px 24px rgba(238,90,36,0.45)',
  transition: 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
  zIndex: 100,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontWeight: 300,
}

const overlayStyle = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: 'rgba(0,0,0,0.55)',
  backdropFilter: 'blur(6px)',
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'center',
  zIndex: 200,
}

const sheetStyle = {
  background: 'white',
  width: '100%',
  maxWidth: '480px',
  borderRadius: '24px 24px 0 0',
  padding: '24px',
  maxHeight: '88vh',
  overflowY: 'auto',
  boxShadow: '0 -8px 40px rgba(0,0,0,0.2)',
  boxSizing: 'border-box',
}

const closeBtnStyle = {
  width: '38px',
  height: '38px',
  borderRadius: '50%',
  border: 'none',
  background: '#f0f0f0',
  cursor: 'pointer',
  fontSize: '18px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#666',
  transition: 'all 0.2s',
}

const formGroupStyle = { marginBottom: '16px' }
const labelStyle = { display: 'block', fontSize: '13px', fontWeight: 600, color: '#555', marginBottom: '6px' }
const inputStyle = {
  width: '100%',
  padding: '12px 14px',
  border: '2px solid #e8e8e8',
  borderRadius: '12px',
  fontSize: '15px',
  transition: 'border-color 0.2s, box-shadow 0.2s',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
  outline: 'none',
}

const uploadAreaStyle = {
  border: '2px dashed #c5cae9',
  borderRadius: '16px',
  padding: '32px 20px',
  textAlign: 'center',
  cursor: 'pointer',
  transition: 'all 0.2s',
  background: '#f8f9ff',
}

const btnPrimaryStyle = {
  width: '100%',
  padding: '14px',
  background: 'linear-gradient(135deg, #3949ab, #1a237e)',
  color: 'white',
  border: 'none',
  borderRadius: '14px',
  fontSize: '16px',
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'all 0.2s',
  boxShadow: '0 4px 16px rgba(57,73,171,0.25)',
}

const btnSecondaryStyle = {
  width: '100%',
  padding: '14px',
  background: '#f5f5f5',
  color: '#555',
  border: 'none',
  borderRadius: '14px',
  fontSize: '16px',
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'all 0.2s',
}

const cardStyle = {
  background: 'white',
  borderRadius: '16px',
  padding: '16px',
  boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
  display: 'flex',
  gap: '14px',
  alignItems: 'center',
  transition: 'all 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
  cursor: 'pointer',
  border: '1px solid transparent',
}

const settingsPanelStyle = {
  background: '#f8f9fa',
  borderRadius: '16px',
  padding: '18px',
  border: '1px solid #e8e8e8',
}

const settingRowStyle = {
  display: 'flex',
  justify: 'space-between',
  alignItems: 'center',
  marginBottom: '14px',
}

const settingLabelStyle = { fontSize: '13px', color: '#444', fontWeight: 500 }
const settingSelectStyle = {
  padding: '8px 12px',
  border: '1px solid #ddd',
  borderRadius: '10px',
  fontSize: '13px',
  background: 'white',
  outline: 'none',
}

const iconBtnStyle = (bg, color) => ({
  width: '38px',
  height: '38px',
  borderRadius: '10px',
  border: 'none',
  cursor: 'pointer',
  fontSize: '16px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: bg,
  color: color,
  transition: 'all 0.2s',
  boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
})

const viewerContainerStyle = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  padding: '16px',
  fontFamily: "'Sarabun', sans-serif",
  boxSizing: 'border-box',
}

const viewerBoxStyle = {
  background: 'white',
  borderRadius: '20px',
  padding: '32px',
  textAlign: 'center',
  maxWidth: '400px',
  width: '100%',
  boxSizing: 'border-box',
  boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
}
