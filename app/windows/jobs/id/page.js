"use client";

import { useParams } from "next/navigation";
import JobForm from "../../../../components/windows/JobForm";

export default function EditWindowsJobPage() {
  const { id } = useParams();
  return <JobForm key={id} jobId={id} />;
}