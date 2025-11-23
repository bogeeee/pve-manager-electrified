Ext.define('PVE.qemu.CDInputPanel', {
    extend: 'Proxmox.panel.InputPanel',
    alias: 'widget.pveQemuCDInputPanel',

    insideWizard: false,

    onGetValues: function (values) {
        var me = this;

        var confid = me.confid || values.controller + values.deviceid;

        me.drive.media = 'cdrom';
        if (values.mediaType === 'iso') {
            me.drive.file = values.cdimage;
        } else if (values.mediaType === 'cdrom') {
            me.drive.file = 'cdrom';
        } else {
            me.drive.file = 'none';
        }

        var params = {};

        params[confid] = PVE.Parser.printQemuDrive(me.drive);

        return params;
    },

    setVMConfig: function (vmconfig) {
        var me = this;

        if (me.bussel) {
            me.bussel.setVMConfig(vmconfig, 'cdrom');
        }
    },

    setDrive: function (drive) {
        var me = this;

        var values = {};
        if (drive.file === 'cdrom') {
            values.mediaType = 'cdrom';
        } else if (drive.file === 'none') {
            values.mediaType = 'none';
        } else {
            values.mediaType = 'iso';
            values.cdimage = drive.file;
        }

        me.drive = drive;

        me.setValues(values);
    },

    setNodename: function (nodename) {
        var me = this;

        me.isosel.setNodename(nodename);
    },

    initComponent: function () {
        var me = this;

        me.drive = {};

        var items = [];

        if (!me.confid) {
            me.bussel = Ext.create('PVE.form.ControllerSelector', {
                withVirtIO: false,
            });
            items.push(me.bussel);
        }

        items.push({
            xtype: 'radiofield',
            name: 'mediaType',
            inputValue: 'iso',
            boxLabel: gettext('Use CD/DVD disc image file (iso)'),
            checked: true,
            listeners: {
                change: function (f, value) {
                    if (!me.rendered) {
                        return;
                    }
                    var cdImageField = me.down('pveIsoSelector');
                    cdImageField.setDisabled(!value);
                    if (value) {
                        cdImageField.validate();
                    } else {
                        cdImageField.reset();
                    }
                },
            },
        });

        me.isosel = Ext.create('PVE.form.IsoSelector', {
            nodename: me.nodename,
            insideWizard: me.insideWizard,
            name: 'cdimage',
        });

        items.push(me.isosel);

        items.push({
            xtype: 'radiofield',
            name: 'mediaType',
            inputValue: 'cdrom',
            boxLabel: gettext('Use physical CD/DVD Drive'),
        });

        items.push({
            xtype: 'radiofield',
            name: 'mediaType',
            inputValue: 'none',
            boxLabel: gettext('Do not use any media'),
        });

        me.items = items;

        me.callParent();
    },
});

Ext.define('PVE.qemu.CDEdit', {
    extend: 'Proxmox.window.Edit',

    width: 400,

    initComponent: function () {
        var me = this;

        var nodename = me.pveSelNode.data.node;
        if (!nodename) {
            throw 'no node name specified';
        }

        me.isCreate = !me.confid;

        var ipanel = Ext.create('PVE.qemu.CDInputPanel', {
            confid: me.confid,
            nodename: nodename,
        });

        Ext.applyIf(me, {
            subject: 'CD/DVD Drive',
            items: [ipanel],
        });

        me.callParent();

        me.load({
            success: function (response, options) {
                ipanel.setVMConfig(response.result.data);
                if (me.confid) {
                    let value = response.result.data[me.confid];
                    let drive = PVE.Parser.parseQemuDrive(me.confid, value);
                    if (!drive) {
                        Ext.Msg.alert('Error', 'Unable to parse drive options');
                        me.close();
                        return;
                    }
                    ipanel.setDrive(drive);
                }
            },
        });
    },
});
