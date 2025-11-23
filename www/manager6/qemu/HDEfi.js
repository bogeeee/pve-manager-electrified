Ext.define('PVE.qemu.EFIDiskInputPanel', {
    extend: 'Proxmox.panel.InputPanel',
    alias: 'widget.pveEFIDiskInputPanel',

    insideWizard: false,

    unused: false, // ADD usused disk imaged

    vmconfig: {}, // used to select usused disks

    onGetValues: function (values) {
        var me = this;

        if (me.disabled) {
            return {};
        }

        var confid = 'efidisk0';

        if (values.hdimage) {
            me.drive.file = values.hdimage;
        } else {
            // we use 1 here, because for efi the size gets overridden from the backend
            me.drive.file = values.hdstorage + ':1';
        }

        // always default to newer 4m type with secure boot support, if we're
        // adding a new EFI disk there can't be any old state anyway
        me.drive.efitype = '4m';
        me.drive['pre-enrolled-keys'] = values.preEnrolledKeys;
        delete values.preEnrolledKeys;

        me.drive.format = values.diskformat;
        let params = {};
        params[confid] = PVE.Parser.printQemuDrive(me.drive);
        return params;
    },

    setNodename: function (nodename) {
        var me = this;
        me.down('#hdstorage').setNodename(nodename);
        me.down('#hdimage').setStorage(undefined, nodename);
    },

    setDisabled: function (disabled) {
        let me = this;
        me.down('pveDiskStorageSelector').setDisabled(disabled);
        me.down('proxmoxcheckbox[name=preEnrolledKeys]').setDisabled(disabled);
        me.callParent(arguments);
    },

    initComponent: function () {
        var me = this;

        me.drive = {};

        me.items = [
            {
                xtype: 'pveDiskStorageSelector',
                name: 'efidisk0',
                storageLabel: gettext('EFI Storage'),
                storageContent: 'images',
                nodename: me.nodename,
                disabled: me.disabled,
                hideSize: true,
            },
            {
                xtype: 'proxmoxcheckbox',
                name: 'preEnrolledKeys',
                checked: true,
                fieldLabel: gettext('Pre-Enroll keys'),
                disabled: me.disabled,
                //boxLabel: '(e.g., Microsoft secure-boot keys')',
                autoEl: {
                    tag: 'div',
                    'data-qtip': gettext(
                        'Use EFIvars image with standard distribution and Microsoft secure boot keys enrolled.',
                    ),
                },
            },
            {
                xtype: 'label',
                text: gettext("Warning: The VM currently does not uses 'OVMF (UEFI)' as BIOS."),
                userCls: 'pmx-hint',
                hidden: me.usesEFI,
            },
        ];

        me.callParent();
    },
});

Ext.define('PVE.qemu.EFIDiskEdit', {
    extend: 'Proxmox.window.Edit',

    isAdd: true,
    subject: gettext('EFI Disk'),

    width: 450,
    initComponent: function () {
        var me = this;

        var nodename = me.pveSelNode.data.node;
        if (!nodename) {
            throw 'no node name specified';
        }

        me.items = [
            {
                xtype: 'pveEFIDiskInputPanel',
                onlineHelp: 'qm_bios_and_uefi',
                confid: me.confid,
                nodename: nodename,
                usesEFI: me.usesEFI,
                isCreate: true,
            },
        ];

        me.callParent();
    },
});
