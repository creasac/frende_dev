'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

interface AvatarCropperProps {
  imageFile: File
  onCropComplete: (croppedBlob: Blob) => void
  onCancel: () => void
}

export default function AvatarCropper({ imageFile, onCropComplete, onCancel }: AvatarCropperProps) {
  const [imageSrc, setImageSrc] = useState<string>('')
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 })
  const [minScale, setMinScale] = useState(1)

  const containerRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)

  const CROP_SIZE = 200 // Size of the crop area
  const MAX_ZOOM = 10 // Allow significant zoom in

  // Load image from file
  useEffect(() => {
    const reader = new FileReader()
    reader.onload = (e) => {
      setImageSrc(e.target?.result as string)
    }
    reader.readAsDataURL(imageFile)
  }, [imageFile])

  // Get natural image dimensions once loaded
  const handleImageLoad = () => {
    if (imageRef.current) {
      const { naturalWidth, naturalHeight } = imageRef.current
      setImageSize({ width: naturalWidth, height: naturalHeight })

      // Minimum scale: the SMALLER dimension must fill the crop circle
      // This ensures the crop circle never goes outside the image bounds
      const minScaleValue = CROP_SIZE / Math.min(naturalWidth, naturalHeight)
      setMinScale(minScaleValue)
      setScale(minScaleValue) // Start at minimum zoom (full image visible as much as possible)
      setPosition({ x: 0, y: 0 })
    }
  }

  // Calculate position boundaries based on current scale
  // The crop circle (CROP_SIZE) must stay within the scaled image
  const getPositionBounds = useCallback((currentScale: number) => {
    const scaledWidth = imageSize.width * currentScale
    const scaledHeight = imageSize.height * currentScale

    // How much the image extends beyond the crop circle on each side
    const maxX = Math.max(0, (scaledWidth - CROP_SIZE) / 2)
    const maxY = Math.max(0, (scaledHeight - CROP_SIZE) / 2)

    return { maxX, maxY }
  }, [imageSize])

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y })
  }

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return

    const newX = e.clientX - dragStart.x
    const newY = e.clientY - dragStart.y

    const { maxX, maxY } = getPositionBounds(scale)

    setPosition({
      x: Math.max(-maxX, Math.min(maxX, newX)),
      y: Math.max(-maxY, Math.min(maxY, newY))
    })
  }, [isDragging, dragStart, scale, getPositionBounds])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  const handleScaleChange = useCallback((newScale: number) => {
    // Clamp scale: min ensures crop circle stays in image, max allows deep zoom
    const clampedScale = Math.max(minScale, Math.min(MAX_ZOOM, newScale))

    // Adjust position to stay within bounds at new scale
    const { maxX, maxY } = getPositionBounds(clampedScale)

    setScale(clampedScale)
    setPosition(prev => ({
      x: Math.max(-maxX, Math.min(maxX, prev.x)),
      y: Math.max(-maxY, Math.min(maxY, prev.y))
    }))
  }, [minScale, getPositionBounds])

  // Mouse wheel zoom on image
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.1 : 0.1
    handleScaleChange(scale + delta)
  }, [scale, handleScaleChange])

  // Touch support
  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0]
    setIsDragging(true)
    setDragStart({ x: touch.clientX - position.x, y: touch.clientY - position.y })
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return
    const touch = e.touches[0]

    const newX = touch.clientX - dragStart.x
    const newY = touch.clientY - dragStart.y

    const { maxX, maxY } = getPositionBounds(scale)

    setPosition({
      x: Math.max(-maxX, Math.min(maxX, newX)),
      y: Math.max(-maxY, Math.min(maxY, newY))
    })
  }

  const handleTouchEnd = () => {
    setIsDragging(false)
  }

  const handleCrop = async () => {
    if (!imageRef.current) return

    const canvas = document.createElement('canvas')
    canvas.width = CROP_SIZE
    canvas.height = CROP_SIZE
    const ctx = canvas.getContext('2d')

    if (!ctx) return

    // Calculate the source coordinates
    const scaledWidth = imageSize.width * scale
    const scaledHeight = imageSize.height * scale

    // Center of the crop area in the scaled image space
    const cropCenterX = scaledWidth / 2 - position.x
    const cropCenterY = scaledHeight / 2 - position.y

    // Convert to original image coordinates
    const srcX = (cropCenterX - CROP_SIZE / 2) / scale
    const srcY = (cropCenterY - CROP_SIZE / 2) / scale
    const srcWidth = CROP_SIZE / scale
    const srcHeight = CROP_SIZE / scale

    ctx.drawImage(
      imageRef.current,
      srcX,
      srcY,
      srcWidth,
      srcHeight,
      0,
      0,
      CROP_SIZE,
      CROP_SIZE
    )

    canvas.toBlob((blob) => {
      if (blob) {
        onCropComplete(blob)
      }
    }, 'image/jpeg', 0.9)
  }

  if (!imageSrc) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-white rounded-lg p-6">
          <p>Loading image...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg p-6 max-w-md w-full">
        <h3 className="text-lg font-semibold mb-4">Adjust your photo</h3>

        {/* Crop area */}
        <div
          ref={containerRef}
          className="relative mx-auto overflow-hidden bg-gray-100 rounded-lg"
          style={{ width: CROP_SIZE, height: CROP_SIZE }}
          onWheel={handleWheel}
        >
          {/* Image */}
          <div
            className="absolute cursor-move"
            style={{
              left: '50%',
              top: '50%',
              transform: `translate(-50%, -50%) translate(${position.x}px, ${position.y}px)`,
            }}
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imageRef}
              src={imageSrc}
              alt="Crop preview"
              onLoad={handleImageLoad}
              className="max-w-none"
              style={{
                width: imageSize.width * scale,
                height: imageSize.height * scale,
                transform: 'translate(-50%, -50%)',
                marginLeft: '50%',
                marginTop: '50%',
              }}
              draggable={false}
            />
          </div>

          {/* Circular overlay */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)',
              borderRadius: '50%',
            }}
          />

          {/* Circle border */}
          <div
            className="absolute inset-0 pointer-events-none border-2 border-white rounded-full"
          />
        </div>

        {/* Zoom slider */}
        <div className="mt-4">
          <label className="block text-sm text-gray-600 mb-2">Zoom</label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => handleScaleChange(scale - 0.1)}
              className="p-1 rounded hover:bg-gray-100"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
              </svg>
            </button>
            <input
              type="range"
              min={minScale}
              max={MAX_ZOOM}
              step={0.01}
              value={scale}
              onChange={(e) => handleScaleChange(parseFloat(e.target.value))}
              className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-azure"
            />
            <button
              type="button"
              onClick={() => handleScaleChange(scale + 0.1)}
              className="p-1 rounded hover:bg-gray-100"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
        </div>

        <p className="text-xs text-gray-500 mt-2 text-center">
          Drag to reposition • Scroll or use slider to zoom
        </p>

        {/* Buttons */}
        <div className="flex gap-3 mt-6">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCrop}
            className="flex-1 rounded-lg bg-azure px-4 py-2 text-white bg-azure-hover"
          >
            Save Photo
          </button>
        </div>
      </div>
    </div>
  )
}
