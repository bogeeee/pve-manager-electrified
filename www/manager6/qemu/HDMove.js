Ext.define('PVE.window.HDMove', {
    extend: 'Proxmox.window.Edit',
    mixins: ['Proxmox.Mixin.CBind'],

    resizable: false,
    modal: true,
    width: 350,
    border: false,
    layout: 'fit',
    showReset: false,
    showTaskViewer: true,
    method: 'POST',

    cbindData: function () {
        let me = this;
        return {
            disk: me.disk,
            isQemu: me.type === 'qemu',
            nodename: me.nodename,
            url: () => {
                let endpoint = me.type === 'qemu' ? 'move_disk' : 'move_volume';
                return `/nodes/${me.nodename}/${me.type}/${me.vmid}/${endpoint}`;
            },
        };
    },

    cbind: {
        title: (get) => (get('isQemu') ? gettext('Move disk') : gettext('Move Volume')),
        submitText: (get) => get('title'),
        qemu: '{isQemu}',
        url: '{url}',
    },

    getValues: function () {
        let me = this;
        let values = me.formPanel.getForm().getValues();

        let params = {
            storage: values.hdstorage,
        };
        params[me.qemu ? 'disk' : 'volume'] = me.disk;

        if (values.diskformat && me.qemu) {
            params.format = values.diskformat;
        }

        if (values.deleteDisk) {
            params.delete = 1;
        }
        return params;
    },

    items: [
        {
            xtype: 'form',
            reference: 'moveFormPanel',
            border: false,
            fieldDefaults: {
                labelWidth: 100,
                anchor: '100%',
            },
            items: [
                {
                    xtype: 'displayfield',
                    cbind: {
                        name: (get) => (get('isQemu') ? 'disk' : 'volume'),
                        fieldLabel: (get) =>
                            get('isQemu') ? gettext('Disk') : gettext('Mount Point'),
                        value: '{disk}',
                    },
                    allowBlank: false,
                },
                {
                    xtype: 'pveDiskStorageSelector',
                    storageLabel: gettext('Target Storage'),
                    cbind: {
                        nodename: '{nodename}',
                        storageContent: (get) => (get('isQemu') ? 'images' : 'rootdir'),
                    },
                    hideSize: true,
                },
                {
                    xtype: 'proxmoxcheckbox',
                    fieldLabel: gettext('Delete source'),
                    name: 'deleteDisk',
                    uncheckedValue: 0,
                    checked: false,
                },
            ],
        },
    ],

    initComponent: function () {
        let me = this;

        if (!me.nodename) {
            throw 'no node name specified';
        }

        if (!me.vmid) {
            throw 'no VM ID specified';
        }

        if (!me.type) {
            throw 'no type specified';
        }

        me.callParent();
    },
});
