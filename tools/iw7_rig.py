"""Export native IW7 bones and all eight skeletal vertex influences."""
import struct
import numpy as np
from extract_spaceland import OUTPUT, key


def multiply(a, b):
    ax, ay, az, aw = a; bx, by, bz, bw = b
    return np.array([aw*bx+ax*bw+ay*bz-az*by, aw*by+ay*bw+az*bx-ax*bz,
                     aw*bz+az*bw+ax*by-ay*bx, aw*bw-ax*bx-ay*by-az*bz])


def inverse(q):
    q = np.asarray(q, dtype='f8')
    return q * [-1, -1, -1, 1] / max(1e-12, np.dot(q, q))


def rotate(v, q):
    return multiply(multiply(q, [*v, 0]), inverse(q))[:3]


def skeleton(memory, context, h):
    count, roots = h[20:22]
    pointers = struct.unpack_from('<6Q', h, 152)
    names_ptr, parents_ptr, rotation_ptr, translation_ptr, classification, bind_ptr = pointers
    if not count:
        return [{'name':'tag_origin','parent':-1,'position':[0,0,0],'rotation':[0,0,0,1],'globalPosition':[0,0,0],'globalRotation':[0,0,0,1]}]
    ids = memory.unpack('<'+'I'*count, names_ptr)
    parents = list(memory.read(parents_ptr, count-roots))
    local_t = np.frombuffer(memory.read(translation_ptr,(count-roots)*12),dtype='<f4').reshape(-1,3)
    local_q = np.frombuffer(memory.read(rotation_ptr,(count-roots)*8),dtype='<i2').reshape(-1,4).astype('f8')/32768
    bind = np.frombuffer(memory.read(bind_ptr,count*32),dtype='<f4').reshape(-1,8)
    derive = not np.any(local_t)
    result=[]
    for i in range(count):
        parent=i-parents[i-roots] if i>=roots else i-1
        if parent>=i or parent < -1:
            raise ValueError('Invalid native bone hierarchy')
        gq,gt=bind[i,:4],bind[i,4:7]
        if derive:
            q=multiply(inverse(bind[parent,:4]),gq) if parent>=0 else gq
            t=rotate(gt-bind[parent,4:7],inverse(bind[parent,:4])) if parent>=0 else gt
        else:
            q=local_q[i-roots] if i>=roots else np.array([0,0,0,1])
            t=local_t[i-roots] if i>=roots else np.zeros(3)
        if np.linalg.norm(q)<.001:q=np.array([0,0,0,1])
        result.append({'name':memory.string(context['strings']+ids[i]) or f'no_tag_{i}','parent':parent,'position':t.tolist(),'rotation':q.tolist(),
                       'globalPosition':gt.tolist(),'globalRotation':gq.tolist()})
    return result


def weights(memory, surface, count, bones):
    joints=np.zeros((count,8),dtype='<u2'); values=np.zeros((count,8),dtype='<f4')
    rigid_count=surface[6]; rigid_pointer, weight_pointer=struct.unpack_from('<QQ',surface,72)
    at=0
    for i in range(rigid_count):
        bone,n=memory.unpack('<HH',rigid_pointer+i*16)
        joints[at:at+n,0]=bone;values[at:at+n,0]=1;at+=n
    counts=struct.unpack_from('<8H',surface,8)
    total=sum((n+1)*4*size for n,size in enumerate(counts))
    raw=memory.read(weight_pointer,total);offset=0
    for influences, vertices in enumerate(counts,1):
        for _ in range(vertices):
            if at>=count:raise ValueError('Native skin weights exceed vertex count')
            if influences==1:
                joints[at,0],=struct.unpack_from('<H',raw,offset);values[at,0]=1
            else:
                joints[at,0],joints[at,1],weight=struct.unpack_from('<HHH',raw,offset)
                values[at,1]=weight/65536
                for n in range(2,influences):
                    joints[at,n],weight=struct.unpack_from('<HH',raw,offset+6+(n-2)*4)
                    values[at,n]=weight/65536
                values[at,0]=1-values[at,1:influences].sum()
            at+=1;offset+=influences*4
    if at!=count:raise ValueError(f'Native skin weight coverage mismatch: {at}/{count}')
    if int(joints.max())>=bones or np.min(values)<-0.0001:
        raise ValueError('Invalid native bone influence')
    return joints,values


def export_rig(exporter, context, pointer):
    memory=exporter.memory
    h=memory.read(pointer,736);name=memory.string(memory.pointer(pointer));bone_data=skeleton(memory,context,h)
    surfaces,first=struct.unpack_from('<HH',h,228);source=struct.unpack_from('<Q',h,272)[0];material_ptr=struct.unpack_from('<Q',h,216)[0]
    vertices=[];indices=[];joints=[];skin=[];groups=[];vbase=0;ibase=0
    for n in range(surfaces):
        s=memory.read(source+n*256,256);count,faces=struct.unpack_from('<HH',s,2)
        if not count or not faces:continue
        vp,ip=struct.unpack_from('<QQ',s,32)
        raw=np.frombuffer(memory.read(vp,count*32),dtype=np.dtype({'names':['position','uv','normal'],'formats':[('<f4',3),('<f2',2),'<u4'],'offsets':[0,20,24],'itemsize':32}))
        v=np.empty((count,8),dtype='<f4');v[:,:3]=raw['position'];v[:,3:5]=raw['uv']
        for axis in range(3):v[:,5+axis]=((raw['normal']>>(axis*10))&1023)/1023*2-1
        idx=np.frombuffer(memory.read(ip,faces*6),dtype='<u2').astype('<u4')
        j,w=weights(memory,s,count,len(bone_data))
        material=exporter.material(memory.pointer(material_ptr+(first+n)*8))
        groups.append({'start':ibase,'count':len(idx),'material':material});vertices.append(v);indices.append(idx+vbase);joints.append(j);skin.append(w)
        vbase+=count;ibase+=len(idx)
    vertices=np.concatenate(vertices);indices=np.concatenate(indices);joints=np.concatenate(joints);skin=np.concatenate(skin)
    if not np.isfinite(vertices).all() or int(indices.max())>=len(vertices):raise ValueError('Invalid native rig mesh')
    url='rigs/'+key(name)+'.bin';(OUTPUT/'rigs').mkdir(exist_ok=True)
    (OUTPUT/url).write_bytes(struct.pack('<4sIII',b'IW7R',1,len(vertices),len(indices))+vertices.tobytes()+joints.tobytes()+skin.tobytes()+indices.tobytes())
    return {'name':name,'url':url,'bytes':(OUTPUT/url).stat().st_size,'vertices':len(vertices),'indices':len(indices),'bones':bone_data,'groups':groups,
            'maxInfluences':int(np.max(np.sum(skin>0,axis=1))),'bounds':[vertices[:,:3].min(axis=0).tolist(),vertices[:,:3].max(axis=0).tolist()]}


def combine_rigs(name, rigs):
    """IW DObj attachment: share named bones and transform part-local bind meshes."""
    bones=[]; names={}; vertices=[]; indices=[]; joints=[]; skin=[]; groups=[]; vbase=0; ibase=0
    for rig in rigs:
        root=rig['bones'][0]; attachment=names.get(root['name'])
        target=bones[attachment] if attachment is not None else root
        q=multiply(target['globalRotation'],inverse(root['globalRotation']))
        t=np.array(target['globalPosition'])-rotate(root['globalPosition'],q)
        remap=[]
        for bone in rig['bones']:
            if bone['name'] not in names:
                parent=remap[bone['parent']] if bone['parent']>=0 else -1
                b=dict(bone,parent=parent,globalPosition=(rotate(bone['globalPosition'],q)+t).tolist(),globalRotation=multiply(q,bone['globalRotation']).tolist())
                names[b['name']]=len(bones);bones.append(b)
            remap.append(names[bone['name']])
        data=(OUTPUT/rig['url']).read_bytes();n=rig['vertices'];ni=rig['indices']
        v=np.frombuffer(data,dtype='<f4',count=n*8,offset=16).reshape(-1,8).copy()
        # Vectorized quaternion rotation, including unit normalization.
        q=q/np.linalg.norm(q);xyz=q[:3];w=q[3]
        for begin,end in [(0,3),(5,8)]:
            points=v[:,begin:end];cross=2*np.cross(xyz,points);points[:]=points+w*cross+np.cross(xyz,cross)
        v[:,:3]+=t
        j=np.frombuffer(data,dtype='<u2',count=n*8,offset=16+n*32).reshape(-1,8)
        j=np.array(remap,dtype='<u2')[j]
        weights=np.frombuffer(data,dtype='<f4',count=n*8,offset=16+n*48).reshape(-1,8)
        idx=np.frombuffer(data,dtype='<u4',count=ni,offset=16+n*80)
        vertices.append(v);joints.append(j);skin.append(weights);indices.append(idx+vbase)
        groups.extend(dict(g,start=g['start']+ibase,part=rig['name']) for g in rig['groups'])
        vbase+=n;ibase+=ni
    vertices=np.concatenate(vertices);indices=np.concatenate(indices);joints=np.concatenate(joints);skin=np.concatenate(skin)
    url='rigs/'+key(name)+'.bin'
    (OUTPUT/url).write_bytes(struct.pack('<4sIII',b'IW7R',1,len(vertices),len(indices))+vertices.tobytes()+joints.tobytes()+skin.tobytes()+indices.tobytes())
    return {'name':name,'url':url,'bytes':(OUTPUT/url).stat().st_size,'vertices':len(vertices),'indices':len(indices),'bones':bones,'groups':groups,
            'maxInfluences':int(np.max(np.sum(skin>0,axis=1))),'bounds':[vertices[:,:3].min(axis=0).tolist(),vertices[:,:3].max(axis=0).tolist()]}
