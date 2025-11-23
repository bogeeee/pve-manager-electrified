Ext.define('PVE.window.MPResize', {
    extend: 'Ext.window.Window',

    resizable: false,

    resize_disk: function (disk, size) {
        var me = this;
        var params = { disk: disk, size: '+' + size + 'G' };

        Proxmox.Utils.API2Request({
            params: params,
            url: '/nodes/' + me.nodename + '/lxc/' + me.vmid + '/resize',
            waitMsgTarget: me,
            method: 'PUT',
            failure: function (response, opts) {
                Ext.Msg.alert(gettext('Error'), response.htmlStatus);
            },
            success: function (response, opts) {
                var upid = response.result.data;
                var win = Ext.create('Proxmox.window.TaskViewer', { upid: upid });
                win.show();
                me.close();
            },
        });
    },

    initComponent: function () {
        var me = this;

        if (!me.nodename) {
            throw 'no node name specified';
        }

        if (!me.vmid) {
            throw 'no VM ID specified';
        }

        var items = [
            {
                xtype: 'displayfield',
                name: 'disk',
                value: me.disk,
                fieldLabel: gettext('Disk'),
                vtype: 'StorageId',
                allowBlank: false,
            },
        ];

        me.hdsizesel = Ext.createWidget('numberfield', {
            name: 'size',
            minValue: 0,
            maxValue: 128 * 1024,
            decimalPrecision: 3,
            value: '0',
            fieldLabel: `${gettext('Size Increment')} (${gettext('GiB')})`,
            allowBlank: false,
        });

        items.push(me.hdsizesel);

        me.formPanel = Ext.create('Ext.form.Panel', {
            bodyPadding: 10,
            border: false,
            fieldDefaults: {
                labelWidth: 120,
                anchor: '100%',
            },
            items: items,
        });

        var form = me.formPanel.getForm();

        var submitBtn;

        me.title = gettext('Resize disk');
        submitBtn = Ext.create('Ext.Button', {
            text: gettext('Resize disk'),
            handler: function () {
                if (form.isValid()) {
                    let values = form.getValues();
                    me.resize_disk(me.disk, values.size);
                }
            },
        });

        Ext.apply(me, {
            modal: true,
            border: false,
            layout: 'fit',
            buttons: [submitBtn],
            items: [me.formPanel],
        });

        me.callParent();
    },
});
