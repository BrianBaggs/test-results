import { useRef } from 'react';
import { UploadIcon, FileIcon, AlertCircleIcon, LoaderIcon } from 'lucide-react';

interface FileUploaderProps {
  onFileUpload: (file: File) => void;
  isLoading: boolean;
  error: string | null;
}

export const FileUploader: React.FC<FileUploaderProps> = ({
  onFileUpload,
  isLoading,
  error
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileUpload(file);
    }
  };
  return <div className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-gray-300 rounded-lg bg-gray-50">
      <input id="file-upload" name="fileUpload" type="file" ref={fileInputRef} onChange={handleFileChange} accept=".xml" className="hidden" aria-label="Upload XML file" />
      {isLoading ? <div className="flex flex-col items-center text-gray-500">
          <LoaderIcon className="w-12 h-12 animate-spin mb-4" />
          <p>Processing your file...</p>
        </div> : error ? <div className="flex flex-col items-center text-red-500">
          <AlertCircleIcon className="w-12 h-12 mb-4" />
          <p className="mb-4 text-center">{error}</p>
          <button onClick={() => fileInputRef.current?.click()} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors">
            Try Again
          </button>
        </div> : <>
          <FileIcon className="w-12 h-12 text-gray-400 mb-4" />
          <p className="mb-2 text-lg font-medium text-gray-700">
            Upload JUnit XML File
          </p>
          <p className="mb-4 text-sm text-gray-500">
            Drag and drop or click to upload
          </p>
          <button onClick={() => fileInputRef.current?.click()} className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors">
            <UploadIcon className="w-5 h-5 mr-2" />
            Select File
          </button>
        </>}
    </div>;
};