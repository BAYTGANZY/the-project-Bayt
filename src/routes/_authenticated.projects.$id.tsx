  const save = useMutation({
    mutationFn: async () => {
      if (profile?.role !== "admin") {
        throw new Error("Endast BAYT kan ändra projektets grunduppgifter.");
      }

      const previousAssignedContactId =
        projectQ.data?.assigned_contact_id ?? null;
      const assignmentChanged =
        previousAssignedContactId !== assignedContactId;

      const { error: saveError } = await supabase
        .from("projects")
        .update({
          property_id: propertyId || null,
          title,
          description: description || null,
          budget: budget ? Number(budget) : null,
          start_date: startDate || null,
          end_date: endDate || null,
          deadline: deadline || null,
          assigned_contact_id: assignedContactId,
        })
        .eq("id", id);

      if (saveError) throw saveError;

      let emailSent = false;

      if (assignmentChanged && assignedContactId) {
        const { error: emailError } = await supabase.functions.invoke(
          "notify-entreprenor",
          { body: { kind: "project", id } },
        );

        if (emailError) {
          throw new Error(
            `Projektet sparades, men mejlet kunde inte skickas. ${emailError.message}`,
          );
        }

        emailSent = true;
      }

      return { emailSent };
    },
    onSuccess: ({ emailSent }) => {
      qc.invalidateQueries({ queryKey: ["project", id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      setError(null);

      toast.success(
        emailSent
          ? "Projektet sparades och uppdraget skickades via mejl."
          : "Projektet sparades.",
        { style: { background: "#3D8A30", color: "#fff" } },
      );
    },
    onError: (e: any) => {
      const message = e.message ?? "Kunde inte spara projektet.";
      setError(message);
      toast.error(message);
    },
  });
