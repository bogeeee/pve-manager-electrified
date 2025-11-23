/*
 * Input panel for notification options of backup jobs.
 */
Ext.define('PVE.panel.BackupNotificationOptions', {
    extend: 'Proxmox.panel.InputPanel',
    xtype: 'pveBackupNotificationOptionsPanel',
    mixins: ['Proxmox.Mixin.CBind'],

    onlineHelp: 'chapter_notifications',

    cbindData: function () {
        let me = this;
        me.isCreate = !!me.isCreate;
        return {};
    },

    viewModel: {
        data: {
            notificationMode: undefined,
        },
        formulas: {
            showMailtoFields: (get) => {
                let mode = get('notificationMode');
                return mode['notification-mode'] === 'legacy-sendmail';
            },
        },
    },

    onSetValues: function (values) {
        let me = this;

        let mode = values['notification-mode'] ?? 'auto';
        let mailto = values.mailto;

        let mappedMode = 'legacy-sendmail';

        // The 'auto' mode is a bit annoying and confusing, so we try
        // to map it to the equivalent behavior.
        if ((mode === 'auto' && !mailto) || mode === 'notification-system') {
            mappedMode = 'notification-system';
        }

        me.getViewModel().set('notificationMode', { 'notification-mode': mappedMode });

        values['notification-mode'] = mappedMode;
        return values;
    },

    items: [
        {
            xtype: 'radiogroup',
            height: '15px',
            layout: {
                type: 'vbox',
            },
            bind: {
                value: '{notificationMode}',
            },
            items: [
                {
                    xtype: 'radiofield',
                    name: 'notification-mode',
                    inputValue: 'notification-system',
                    boxLabel: gettext('Use global notification settings'),
                    cbind: {
                        checked: '{isCreate}',
                    },
                },
                {
                    xtype: 'radiofield',
                    name: 'notification-mode',
                    inputValue: 'legacy-sendmail',
                    boxLabel: gettext('Use sendmail to send an email (legacy)'),
                },
            ],
        },
        {
            xtype: 'textfield',
            fieldLabel: gettext('Recipients'),
            emptyText: 'test@example.com, ...',
            name: 'mailto',
            padding: '0 0 0 50',
            disabled: true,
            bind: {
                disabled: '{!showMailtoFields}',
            },
        },
        {
            xtype: 'pveEmailNotificationSelector',
            fieldLabel: gettext('When'),
            name: 'mailnotification',
            padding: '0 0 0 50',
            disabled: true,
            value: 'always',
            cbind: {
                deleteEmpty: '{!isCreate}',
            },
            bind: {
                disabled: '{!showMailtoFields}',
            },
        },
    ],
});
