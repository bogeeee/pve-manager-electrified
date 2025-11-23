Ext.define('PVE.qemu.CIDriveInputPanel', {
    extend: 'Proxmox.panel.InputPanel',
    xtype: 'pveCIDriveInputPanel',

    insideWizard: false,

    vmconfig: {}, // used to select usused disks

    onGetValues: function (values) {
        var _me = this;

        var drive = {};
        var params = {};
        drive.file = values.hdstorage + ':cloudinit';
        drive.format = values.diskformat;
        params[values.controller + values.deviceid] = PVE.Parser.printQemuDrive(drive);
        return params;
    },

    setNodename: function (nodename) {
        var me = this;
        me.down('#hdstorage').setNodename(nodename);
        me.down('#hdimage').setStorage(undefined, nodename);
    },

    setVMConfig: function (config) {
        var me = this;
        me.down('#drive').setVMConfig(config, 'cdrom');
    },

    initComponent: function () {
        var me = this;

        me.drive = {};

        me.items = [
            {
                xtype: 'pveControllerSelector',
                withVirtIO: false,
                itemId: 'drive',
                fieldLabel: gettext('CloudInit Drive'),
                name: 'drive',
            },
            {
                xtype: 'pveDiskStorageSelector',
                itemId: 'storselector',
                storageContent: 'images',
                nodename: me.nodename,
                hideSize: true,
            },
        ];
        me.callParent();
    },
});

Ext.define('PVE.qemu.CIDriveEdit', {
    extend: 'Proxmox.window.Edit',
    xtype: 'pveCIDriveEdit',

    isCreate: true,
    subject: gettext('CloudInit Drive'),

    initComponent: function () {
        var me = this;

        var nodename = me.pveSelNode.data.node;
        if (!nodename) {
            throw 'no node name specified';
        }

        me.items = [
            {
                xtype: 'pveCIDriveInputPanel',
                itemId: 'cipanel',
                nodename: nodename,
            },
        ];

        me.callParent();

        me.load({
            success: function (response, opts) {
                me.down('#cipanel').setVMConfig(response.result.data);
            },
        });
    },
});
