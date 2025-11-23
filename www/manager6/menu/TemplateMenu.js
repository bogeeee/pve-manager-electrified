Ext.define('PVE.menu.TemplateMenu', {
    extend: 'Ext.menu.Menu',

    initComponent: function () {
        let me = this;

        let info = me.pveSelNode.data;
        if (!info.node) {
            throw 'no node name specified';
        }
        if (!info.vmid) {
            throw 'no VM ID specified';
        }

        let guestType = me.pveSelNode.data.type;
        if (guestType !== 'qemu' && guestType !== 'lxc') {
            throw `invalid guest type ${guestType}`;
        }

        let template = me.pveSelNode.data.template;

        me.title = (guestType === 'qemu' ? 'VM ' : 'CT ') + info.vmid;

        let caps = Ext.state.Manager.get('GuiCap');
        let standaloneNode = PVE.Utils.isStandaloneNode();

        me.items = [
            {
                text: gettext('Migrate'),
                iconCls: 'fa fa-fw fa-send-o',
                hidden: standaloneNode || !caps.vms['VM.Migrate'],
                handler: function () {
                    Ext.create('PVE.window.Migrate', {
                        vmtype: guestType,
                        nodename: info.node,
                        vmid: info.vmid,
                        autoShow: true,
                    });
                },
            },
            {
                text: gettext('Clone'),
                iconCls: 'fa fa-fw fa-clone',
                hidden: !caps.vms['VM.Clone'],
                handler: function () {
                    Ext.create('PVE.window.Clone', {
                        nodename: info.node,
                        guestType: guestType,
                        vmid: info.vmid,
                        isTemplate: template,
                        autoShow: true,
                    });
                },
            },
        ];

        me.callParent();
    },
});
